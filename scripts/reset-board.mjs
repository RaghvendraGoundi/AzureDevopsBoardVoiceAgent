import { rmSync } from "node:fs";
import path from "node:path";

// The board reseeds itself from src/lib/devops/seed.ts when the file is missing.
rmSync(path.join(process.cwd(), ".data", "board.json"), { force: true });
console.log("Board reset. It will be reseeded on next request.");
