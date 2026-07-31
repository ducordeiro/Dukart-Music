const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");

async function main() {
  const [, , dbPath, musicDir] = process.argv;

  if (!dbPath || !musicDir) {
    throw new Error("Uso: node patch-db-paths.cjs <dbPath> <musicDir>");
  }

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Banco nao encontrado: ${dbPath}`);
  }

  fs.mkdirSync(musicDir, { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
  });

  const db = new SQL.Database(fs.readFileSync(dbPath));
  const rows = db.exec("SELECT id_file, file_path, file_name FROM local_file");

  if (!rows.length) {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    return;
  }

  const statement = db.prepare("UPDATE local_file SET file_path = ?, file_name = ? WHERE id_file = ?");

  for (const row of rows[0].values) {
    const idFile = Number(row[0]);
    const oldPath = String(row[1] || "");
    const oldName = String(row[2] || "");
    const fileName = oldName || path.basename(oldPath);
    if (!fileName) continue;
    statement.run([path.join(musicDir, fileName), fileName, idFile]);
  }

  statement.free();
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
