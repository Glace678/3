import { createRequire } from "node:module";
import process from "node:process";

const [modulePath, configuration] = process.argv.slice(2);
if (!modulePath || !configuration) {
  process.stderr.write("Usage: OpenCcBridge.mjs <opencc-module-path> <configuration>\n");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { OpenCC } = require(modulePath);
const converter = new OpenCC(configuration);

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const values = JSON.parse(input);
const converted = values.map((value) => converter.convertSync(value));
process.stdout.write(JSON.stringify(converted));
