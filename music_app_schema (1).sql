PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- Informacoes obtidas a partir do link informado pelo usuario.
CREATE TABLE media_source (
    id_media INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'youtube',
    external_id TEXT,
    title TEXT,
    channel_name TEXT,
    duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    thumbnail_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (platform, external_id)
);

-- Cada tentativa de download feita pelo aplicativo.
CREATE TABLE download (
    id_download INTEGER PRIMARY KEY AUTOINCREMENT,
    id_media INTEGER NOT NULL,
    requested_type TEXT NOT NULL CHECK (requested_type IN ('audio', 'video')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'downloading', 'completed', 'failed', 'cancelled')),
    progress_percent REAL NOT NULL DEFAULT 0
        CHECK (progress_percent >= 0 AND progress_percent <= 100),
    requested_format TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_media) REFERENCES media_source (id_media)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- Arquivo final salvo no computador. O conteudo nao e armazenado como BLOB.
CREATE TABLE local_file (
    id_file INTEGER PRIMARY KEY AUTOINCREMENT,
    id_download INTEGER NOT NULL UNIQUE,
    file_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_extension TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    checksum_sha256 TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_download) REFERENCES download (id_download)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- Cache de pesquisas feitas na YouTube Data API para evitar consumo repetido de cota.
CREATE TABLE youtube_search_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL UNIQUE,
    results_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Conta autenticada no aplicativo.
CREATE TABLE app_user (
    id_user INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE auth_session (
    id_session INTEGER PRIMARY KEY AUTOINCREMENT,
    id_user INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (id_user) REFERENCES app_user (id_user)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- Playlists, favoritos e demais dados da biblioteca pertencem a uma conta.
CREATE TABLE user_library (
    id_user INTEGER PRIMARY KEY,
    playlists_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (id_user) REFERENCES app_user (id_user)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- Associa o historico e os arquivos locais as contas que os adicionaram.
-- Um mesmo arquivo pode ser reutilizado por mais de uma conta sem duplicacao.
CREATE TABLE user_download (
    id_user INTEGER NOT NULL,
    id_download INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (id_user, id_download),
    FOREIGN KEY (id_download) REFERENCES download (id_download)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX idx_media_source_url
    ON media_source (source_url);

CREATE INDEX idx_download_media
    ON download (id_media);

CREATE INDEX idx_download_status
    ON download (status);

CREATE INDEX idx_download_created_at
    ON download (created_at);

CREATE INDEX idx_youtube_search_cache_query
    ON youtube_search_cache (query);

CREATE INDEX idx_auth_session_token
    ON auth_session (token_hash);

CREATE INDEX idx_auth_session_expiry
    ON auth_session (expires_at);

CREATE INDEX idx_user_download_user
    ON user_download (id_user, created_at);

CREATE INDEX idx_user_download_download
    ON user_download (id_download);

CREATE TRIGGER trg_media_source_updated_at
AFTER UPDATE ON media_source
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE media_source
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id_media = NEW.id_media;
END;

CREATE TRIGGER trg_download_updated_at
AFTER UPDATE ON download
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE download
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id_download = NEW.id_download;
END;
