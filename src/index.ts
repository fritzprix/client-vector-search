/** Author: yusufhilmi, lurrobert
 * Let's keep everything here until it gets too big
 * My first npm package, can use help about design patterns, best practices!
 */

import Cache from './cache';
// import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// Whenever you want a fresh indexedDB
const indexedDB = new IDBFactory();

const cacheInstance = Cache.getInstance();

export const getEmbedding = async (
  text: string,
  precision: number = 7,
  options = { pooling: "mean", normalize: false },
  model = "Xenova/gte-small",
): Promise<number[]> => {
  const cachedEmbedding = cacheInstance.get(text);
  if (cachedEmbedding) {
    return Promise.resolve(cachedEmbedding);
  }

  const transformersModule = await import("@xenova/transformers");
  const { pipeline } = transformersModule;
  const pipe = await pipeline("feature-extraction", model);
  const output = await pipe(text, options);
  const roundedOutput = Array.from(output.data as number[]).map(
    (value: number) => parseFloat(value.toFixed(precision))
  );
  cacheInstance.set(text, roundedOutput);
  return Array.from(roundedOutput);
};

export const cosineSimilarity = (
  vecA: number[],
  vecB: number[],
  precision: number = 6
): number => {
  // Check if both vectors have the same length
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  // Compute dot product and magnitudes
  const dotProduct = vecA.reduce((sum, a, i) => {
    const b = vecB[i]; // Extract value safely
    return sum + a * (b !== undefined ? b : 0); // Check for undefined
  }, 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));

  // Check if either magnitude is zero
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  // Calculate cosine similarity and round to specified precision
  return parseFloat(
    (dotProduct / (magnitudeA * magnitudeB)).toFixed(precision)
  );
};

export class EmbeddingIndex {
  private objects: { [key: string]: any }[];
  private keys: string[];
  private db: DynamicDB = new DynamicDB();

  constructor(initialObjects?: { [key: string]: any }[]) {
    this.objects = [];
    this.keys = [];
    if (initialObjects && initialObjects.length > 0) {
      initialObjects.forEach((obj) => this.validateAndAdd(obj));
      if (initialObjects[0]) {
        this.keys = Object.keys(initialObjects[0]);
      }
    }
  }

  private validateAndAdd(obj: { [key: string]: any }) {
    if (!Array.isArray(obj.embedding) || obj.embedding.some(isNaN)) {
      throw new Error(
        "Object must have an embedding property of type number[]"
      );
    }
    if (this.keys.length === 0) {
      this.keys = Object.keys(obj);
    } else if (!this.keys.every((key) => key in obj)) {
      throw new Error(
        "Object must have the same properties as the initial objects"
      );
    }
    this.objects.push(obj);
  }

  add(obj: { [key: string]: any }) {
    this.validateAndAdd(obj);
  }

  // Method to update an existing vector in the index
  update(filter: { [key: string]: any }, vector: { [key: string]: any }) {
    // Find the index of the vector with the given filter
    const index = this.objects.findIndex((object) =>
      Object.keys(filter).every((key) => object[key] === filter[key])
    );
    if (index === -1) {
      throw new Error("Vector not found");
    }
    // Validate and add the new vector
    this.validateAndAdd(vector);
    // Replace the old vector with the new one
    this.objects[index] = vector;
  }

  // Method to remove a vector from the index
  remove(filter: { [key: string]: any }) {
    // Find the index of the vector with the given filter
    const index = this.objects.findIndex((object) =>
      Object.keys(filter).every((key) => object[key] === filter[key])
    );
    if (index === -1) {
      throw new Error("Vector not found");
    }
    // Remove the vector from the index
    this.objects.splice(index, 1);
  }

  // Method to remove multiple vectors from the index
  removeBatch(filters: { [key: string]: any }[]) {
    filters.forEach((filter) => {
      // Find the index of the vector with the given filter
      const index = this.objects.findIndex((object) =>
        Object.keys(filter).every((key) => object[key] === filter[key])
      );
      if (index !== -1) {
        // Remove the vector from the index
        this.objects.splice(index, 1);
      }
    });
  }

  // Method to retrieve a vector from the index
  get(filter: { [key: string]: any }) {
    // Find the vector with the given filter
    const vector = this.objects.find((object) =>
      Object.keys(filter).every((key) => object[key] === filter[key])
    );
    if (!vector) {
      return null;
    }
    // Return the vector
    return vector;
  }

  search(
    queryEmbedding: number[],
    options: { topK?: number; filter?: { [key: string]: any } } = { topK: 3 }
  ) {
    const topK = options.topK || 3;
    const filter = options.filter || {};

    // Compute similarities
    const similarities = this.objects
      .filter((object) =>
        Object.keys(filter).every((key) => object[key] === filter[key])
      )
      .map((obj) => ({
        similarity: cosineSimilarity(queryEmbedding, obj.embedding),
        object: obj,
      }));

    // Sort by similarity and return topK results
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  printIndex() {
    console.log("Index Content:");
    this.objects.forEach((obj, idx) => {
      console.log(`Item ${idx + 1}:`, obj);
    });
  }

  async saveIndexToDB(DBname: string = 'defaultDB', objectStoreName: string = 'DefaultStore'): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.objects || this.objects.length === 0) {
        reject(new Error("Index is empty"));
        return;
      }
      this.db.initializeDB(DBname)
        .then(() => this.db.makeObjectStore(objectStoreName))
        .then(() => {
          this.objects.forEach((obj) => {
            this.db.addToDB(objectStoreName, obj);
          });
          console.log(`Index saved to database '${DBname}' object store '${objectStoreName}'`);
          resolve();
        })
        .catch((error) => {
          console.error("Error saving index to database:", error);
          reject(new Error("Error saving index to database"));
        });
    });
  }

  async loadIndexFromDB(objectStoreName: string = 'DefaultStore'): Promise<void> {
    this.objects = [];

    const generator = this.db.dbGenerator(objectStoreName);
    for await (const record of generator) {
      this.objects.push(record);
    }
    console.log(`Saved ${this.objects.length} objects to the IndexedDB`);
  }
}

export class DynamicDB {
  private db: IDBDatabase | null = null;
  private objectStores: { [key: string]: IDBObjectStore } = {};
  private version: number = 1;

  async initializeDB(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve();
        return;
      }

      const request = indexedDB.open(name, this.version);

      request.onerror = (event) => {
        console.error("IndexedDB error:", event);
        reject(new Error("Database initialization failed"));
      };

      request.onupgradeneeded = () => {
        this.db = request.result;
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.version = this.db.version;
        resolve();
      };
    });
  }

  async createNewVersion(name: string, index: string | null = null): Promise<void> {
    if (this.db) {
      this.db.close();
    }
    this.version++;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.db?.name || "defaultDB", this.version);

      request.onupgradeneeded = () => {
        this.db = request.result;
        if (!this.db.objectStoreNames.contains(name)) {
          const objectStore = this.db.createObjectStore(name, { autoIncrement: true });
          if (index) {
            objectStore.createIndex(`by_${index}`, index, { unique: false });
          }
          this.objectStores[name] = objectStore;
        }
        else {
          console.log(`Object store ${name} already exists`);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = (event) => {
        console.error("IndexedDB error:", event);
        reject(new Error("Failed to create new version"));
      };
    });
  }

  async makeObjectStore(name: string, index: string | null = null): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    console.log(`Creating object store ${name} in version ${this.version + 1}`);
    await this.createNewVersion(name, index);
  }
  async addToDB(name: string, obj: { [key: string]: any }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      if (!this.objectStores || !this.objectStores[name]) {
        reject(new Error("Object store not initialized"));
        return;
      }

      const transaction = this.db.transaction([name], "readwrite");
      const objectStore = transaction.objectStore(name);
      const request = objectStore.add(obj);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event) => {
        console.error("Failed to add object", event);
        reject(new Error("Failed to add object"));
      };
    });
  }
  async getAllFromDB(name: string): Promise<any> {
    const transaction = this.db?.transaction([name], "readonly");
    const objectStore = transaction?.objectStore(name);
    return new Promise((resolve, reject) => {
      if (!objectStore) {
        reject(new Error("Object store not found"));
        return;
      }

      const request = objectStore.getAll();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        console.error("Failed to get objects", event);
        reject(new Error("Failed to get objects"));
      };
    });
  }

  async *dbGenerator(objectStoreName: string): AsyncGenerator<any, void, undefined> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    const transaction = this.db.transaction([objectStoreName], 'readonly');
    const objectStore = transaction.objectStore(objectStoreName);
    const request = objectStore.openCursor();

    let promiseResolver: (value: any) => void;

    request.onsuccess = function(event: Event) {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        promiseResolver(cursor.value);
        cursor.continue();
      } else {
        promiseResolver(null);
      }
    };

    while (true) {
      const promise = new Promise<any>((resolve) => {
        promiseResolver = resolve;
      });
      const value = await promise;
      if (value === null) break;
      yield value;
    }
  }
}

