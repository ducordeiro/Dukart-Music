import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

export class CentralSessionStore {
  constructor(private readonly filePath: string) {}

  load() {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(this.filePath)) return null;
    try {
      return safeStorage.decryptString(fs.readFileSync(this.filePath));
    } catch {
      return null;
    }
  }

  save(token: string | null) {
    if (!token) {
      this.clear();
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, safeStorage.encryptString(token));
  }

  clear() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // A sessao ja foi removida da memoria; o arquivo sera ignorado se estiver corrompido.
    }
  }
}
