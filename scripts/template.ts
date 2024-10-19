// node --loader ts-node/esm --experimental-specifier-resolution=node ./scripts/template.ts
import { sayHello } from "../src/drive/helpers";

console.log("--- ScriptTemplate ---");
sayHello("World");
