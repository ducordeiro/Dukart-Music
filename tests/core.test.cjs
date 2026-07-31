const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AppDatabase } = require("../dist-web-server/electron/database.js");
const { mergeUserPlaylists, playlistTrackKey } = require("../dist-web-server/shared/userLibrary.js");
const { youtubeVideoId } = require("../dist-web-server/shared/youtube.js");

function createTempDirectory(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `esporte-fai-${name}-`));
}

test("normaliza os formatos aceitos de URL do YouTube", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(youtubeVideoId(`https://youtu.be/${id}`), id);
  assert.equal(youtubeVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(youtubeVideoId(`https://music.youtube.com/watch?v=${id}`), id);
  assert.equal(youtubeVideoId("http://youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("mescla alterações concorrentes da biblioteca sem perder faixas", () => {
  const createdAt = "2026-07-31T12:00:00.000Z";
  const liked = { id: "liked", name: "Musicas Curtidas", itemIds: [], items: [], special: "liked", createdAt };
  const playlist = { id: "p1", name: "Treino", itemIds: [], items: [], createdAt };
  const trackA = { key: playlistTrackKey("https://youtu.be/aaaaaaaaaaa", "audio"), url: "https://youtu.be/aaaaaaaaaaa", title: "A", channel: "Canal", type: "audio" };
  const trackB = { key: playlistTrackKey("https://youtu.be/bbbbbbbbbbb", "audio"), url: "https://youtu.be/bbbbbbbbbbb", title: "B", channel: "Canal", type: "audio" };
  const merged = mergeUserPlaylists(
    [liked, playlist],
    [liked, { ...playlist, items: [trackA] }],
    [liked, { ...playlist, items: [trackB] }]
  );
  assert.deepEqual(new Set(merged.find((item) => item.id === "p1").items.map((item) => item.key)), new Set([trackA.key, trackB.key]));
});

test("isola histórico por proprietário e reutiliza o mesmo vídeo", async () => {
  const directory = createTempDirectory("database");
  const database = new AppDatabase(path.join(directory, "test.sqlite"), path.resolve("music_app_schema (1).sql"));
  await database.init();
  const media = database.upsertMedia("https://youtu.be/aaaaaaaaaaa", { id: "aaaaaaaaaaa", title: "Teste" });
  const download = database.createDownload(media, "audio");
  const filePath = path.join(directory, "teste-aaaaaaaaaaa.mp3");
  fs.writeFileSync(filePath, Buffer.alloc(2048, 1));
  const checksum = "a".repeat(64);
  database.completeDownload(download, filePath, "audio/mpeg", 2048, checksum);
  database.linkDownloadToUser(10, download);

  assert.equal(database.listDownloadHistory(10).length, 1);
  assert.equal(database.listDownloadHistory(20).length, 0);
  assert.equal(database.findCompleted("https://www.youtube.com/watch?v=aaaaaaaaaaa", "audio")?.idDownload, download);
  assert.equal(database.getDownload(download)?.checksumSha256, checksum);
});

test("recupera automaticamente um banco corrompido a partir de backup validado", async () => {
  const directory = createTempDirectory("recovery");
  const databasePath = path.join(directory, "test.sqlite");
  const database = new AppDatabase(databasePath, path.resolve("music_app_schema (1).sql"));
  await database.init();
  database.createUser("usuario", "usuario", "hash", "salt");

  const backupDirectory = path.join(directory, "backups");
  assert.equal(fs.readdirSync(backupDirectory).length, 1);
  fs.writeFileSync(databasePath, Buffer.from("arquivo corrompido"));

  const recovered = new AppDatabase(databasePath, path.resolve("music_app_schema (1).sql"));
  await recovered.init();
  assert.equal(recovered.listDownloads().length, 0);
  assert.equal(fs.readdirSync(directory).some((file) => file.startsWith("test.sqlite.corrupt-")), true);
});
