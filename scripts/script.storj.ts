// node --loader ts-node/esm --experimental-specifier-resolution=node ./scripts/script.storj.ts

import dotenv from "dotenv";
dotenv.config();

import { take } from "rxjs/operators";
import { StorjClient, S3ClientAuth } from "../src/drive/storage/storj-web3";
import DriveDB from "../src/drive/core";
import IndexedDBStorage from "../src/drive/storage/indexdb";
import { StorageLocationEnum, FileUUID } from "../src/drive/types";
import { UserID } from "../src/identity/types";

const mockUserID = "user123" as UserID;

const init = async (): Promise<DriveDB> => {
  const indexedDBStorage = IndexedDBStorage.getInstance();
  const driveDB = new DriveDB(indexedDBStorage);
  console.log("constructed DriveDB instance");
  await driveDB.initialize();
  console.log("DriveDB initialized successfully");

  console.log("Initializing StorjClient...");
  const storjAuth: S3ClientAuth = {
    accessKeyId: process.env.STORJ_ACCESS_KEY as string,
    secretAccessKey: process.env.STORJ_SECRET_KEY as string,
    endpoint: process.env.STORJ_ENDPOINT as string,
    defaultBucketName: "officex-simple-test",
  };
  await driveDB.initStorj(storjAuth);
  console.log("StorjClient initialized successfully");

  return driveDB;
};

const uploadFile = (driveDB: DriveDB) => {
  return new Promise<void>((resolve, reject) => {
    const fileName = "test-file2.txt";
    const content = "Hello, Storj via DriveDB!";
    const file = new File([content], fileName, { type: "text/plain" });

    console.log(`Starting upload of file: ${fileName}`);
    const { progress$, uploadComplete$ } = driveDB.uploadFilesFolders(
      [file],
      "Documents/",
      StorageLocationEnum.Web3Storj,
      mockUserID
    );

    progress$.subscribe((update) => {
      console.log(`Upload progress: ${update.percentage}%`);
    });

    uploadComplete$.pipe(take(1)).subscribe({
      next: async (fileUUID: FileUUID) => {
        console.log("Upload completed. File UUID:", fileUUID);
        try {
          const fileMetadata = await driveDB.getFileByID(fileUUID);
          console.log("File metadata:", fileMetadata);
          resolve();
        } catch (error) {
          console.error("Error getting file metadata:", error);
          reject(error);
        }
      },
      error: (error) => {
        console.error("Upload failed:", error);
        reject(error);
      },
    });
  });
};

const listObjects = async () => {
  console.log("Listing objects in bucket...");
  try {
    const objects = await StorjClient.listObjects();
    console.log(
      "Objects in bucket:",
      objects.Contents?.map((obj) => obj.Key)
    );
  } catch (error) {
    console.error("Error listing objects:", error);
  }
};

const runScript = async () => {
  try {
    const driveDB = await init();
    await uploadFile(driveDB);
    await listObjects();
    console.log("Script completed successfully");
  } catch (error) {
    console.error("Script failed:", error);
  }
};

runScript();
