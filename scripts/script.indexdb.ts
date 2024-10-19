// node --loader ts-node/esm --experimental-specifier-resolution=node ./scripts/script.indexdb.ts

import fs from "fs";
import DriveDB from "../src/drive/core";
import {
  mockInputFiles as simpleMockInputFiles,
  mockUserID as simpleMockUserID,
} from "../src/drive/tests/simple.test";
import {
  mockInputFiles as detailedMockInputFiles,
  mockUserID as detailedMockUserID,
} from "../src/drive/tests/detailed.test";
import IndexedDBStorage from "../src/drive/storage/indexdb";

const indexDBStorage = IndexedDBStorage.getInstance();
const driveDB = new DriveDB(indexDBStorage);

driveDB.ping();

const runSimpleTest = () => {
  for (const file of simpleMockInputFiles) {
    driveDB.upsertFileToHashTables(
      file.filePath,
      file.storageLocation,
      simpleMockUserID
    );
  }
  const snapshot = driveDB.exportSnapshot(simpleMockUserID);
  const snapshotSerialized = JSON.stringify(snapshot, null, 2);
  fs.writeFile(
    `scripts/output/${snapshot.snapshotName}`,
    snapshotSerialized,
    (err) => {
      if (err) {
        console.error("Error writing file:", err);
      } else {
        console.log("File written successfully");
      }
    }
  );
};

const runDetailedTest = () => {
  for (const file of detailedMockInputFiles) {
    driveDB.upsertFileToHashTables(
      file.filePath,
      file.storageLocation,
      detailedMockUserID
    );
  }
  const snapshot = driveDB.exportSnapshot(detailedMockUserID);
  const snapshotSerialized = JSON.stringify(snapshot, null, 2);
  fs.writeFile(
    `scripts/output/${snapshot.snapshotName}`,
    snapshotSerialized,
    (err) => {
      if (err) {
        console.error("Error writing file:", err);
      } else {
        console.log("File written successfully");
      }
    }
  );
};

runSimpleTest();
runDetailedTest();
