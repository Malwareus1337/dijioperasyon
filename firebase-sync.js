const https = require('https');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class FirebaseSyncStore extends EventEmitter {
  constructor({ bundledDir, storageDir, createInitialData, ensureSchema }) {
    super();
    this.bundledDir = bundledDir;
    this.storageDir = storageDir;
    this.createInitialData = createInitialData;
    this.ensureSchema = ensureSchema;

    this.dataDir = path.join(this.storageDir, 'data');
    this.localDbFile = path.join(this.dataDir, 'db.json');
    this.userConfigFile = path.join(this.storageDir, 'firebase-config.json');

    this.config = { databaseURL: '', authSecret: '' };
    this.cache = null;
    this.status = {
      connected: false,
      configured: false,
      databaseURL: '',
      lastSyncAt: null,
      lastError: null
    };

    this.streamReq = null;
    this.reconnectTimer = null;
  }

  ensureDirs() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  normalizeDb(raw) {
    const base = raw && typeof raw === 'object' ? raw : this.createInitialData();
    if (!base.shifts || typeof base.shifts !== 'object') {
      base.shifts = this.createInitialData().shifts;
    }
    if (!Array.isArray(base.tasks)) {
      base.tasks = base.tasks && typeof base.tasks === 'object' ? Object.values(base.tasks) : [];
    }
    if (!Array.isArray(base.admins)) {
      base.admins = base.admins && typeof base.admins === 'object' ? Object.values(base.admins) : [];
    }
    if (!Array.isArray(base.staff)) {
      base.staff = base.staff && typeof base.staff === 'object' ? Object.values(base.staff) : [];
    }
    base.staff = base.staff.filter(Boolean).map((s) => ({
      ...s,
      customHours: s.customHours || '',
      weeklyOffDays: Array.isArray(s.weeklyOffDays)
        ? s.weeklyOffDays.map(Number)
        : s.weeklyOffDays && typeof s.weeklyOffDays === 'object'
        ? Object.values(s.weeklyOffDays).map(Number)
        : []
    }));

    if (!base.entries || typeof base.entries !== 'object') base.entries = {};
    if (!base.leaveOverrides || typeof base.leaveOverrides !== 'object') base.leaveOverrides = {};
    if (!base.sessions || typeof base.sessions !== 'object') base.sessions = {};
    if (!base.appRelease || typeof base.appRelease !== 'object') {
      base.appRelease = { latestVersion: '1.0.0', downloadUrl: '', releaseNotes: '', publishedAt: '' };
    }

    this.ensureSchema(base);
    return base;
  }

  loadConfigFromDisk() {
    const candidates = [this.userConfigFile];
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'firebase-config.json'));
    }
    candidates.push(path.join(this.bundledDir, 'firebase-config.json'));

    for (const file of candidates) {
      try {
        if (fs.existsSync(file)) {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (parsed && parsed.databaseURL && String(parsed.databaseURL).trim()) {
            return {
              databaseURL: this.cleanDbUrl(parsed.databaseURL),
              authSecret: parsed.authSecret ? String(parsed.authSecret).trim() : ''
            };
          }
        }
      } catch (_) {}
    }
    return { databaseURL: '', authSecret: '' };
  }

  cleanDbUrl(input) {
    let str = String(input || '').trim();
    // Eğer kullanıcı tüm firebaseConfig kod bloğunu yapıştırdıysa içinden databaseURL'yi ayıkla
    const match = str.match(/https:\/\/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.(?:firebaseio\.com|firebasedatabase\.app)/i);
    if (match) {
      str = match[0];
    }
    return str.replace(/\/+$/, '');
  }

  loadInitialLocalCache() {
    this.ensureDirs();
    if (fs.existsSync(this.localDbFile)) {
      try {
        return this.normalizeDb(JSON.parse(fs.readFileSync(this.localDbFile, 'utf8')));
      } catch (_) {}
    }
    const bundledSeed = path.join(this.bundledDir, 'data', 'db.json');
    if (bundledSeed !== this.localDbFile && fs.existsSync(bundledSeed)) {
      try {
        const seeded = this.normalizeDb(JSON.parse(fs.readFileSync(bundledSeed, 'utf8')));
        fs.writeFileSync(this.localDbFile, JSON.stringify(seeded, null, 2), 'utf8');
        return seeded;
      } catch (_) {}
    }
    const fresh = this.normalizeDb(this.createInitialData());
    fs.writeFileSync(this.localDbFile, JSON.stringify(fresh, null, 2), 'utf8');
    return fresh;
  }

  writeLocalBackup() {
    try {
      this.ensureDirs();
      fs.writeFileSync(this.localDbFile, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (_) {}
  }

  buildFirebaseUrl(subPath = '') {
    const cleanSub = subPath ? '/' + String(subPath).replace(/^\/+|\/+$/g, '') : '';
    const authQuery = this.config.authSecret
      ? `?auth=${encodeURIComponent(this.config.authSecret)}`
      : '';
    return `${this.config.databaseURL}/operasyon${cleanSub}.json${authQuery}`;
  }

  firebaseRequest(method, subPath, bodyObj = undefined) {
    return new Promise((resolve, reject) => {
      if (!this.config.databaseURL) {
        return reject(new Error('Firebase URL tanımlı değil.'));
      }
      const fullUrl = new URL(this.buildFirebaseUrl(subPath));
      const payload = bodyObj !== undefined ? JSON.stringify(bodyObj) : null;

      const req = https.request(
        {
          protocol: fullUrl.protocol,
          hostname: fullUrl.hostname,
          port: fullUrl.port || 443,
          path: fullUrl.pathname + fullUrl.search,
          method,
          headers: payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {}
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(raw ? JSON.parse(raw) : null);
              } catch (e) {
                resolve(null);
              }
            } else {
              let detail = raw;
              try {
                const j = JSON.parse(raw);
                if (j && j.error) detail = j.error;
              } catch (_) {}
              reject(new Error(`Firebase HTTP ${res.statusCode}: ${detail}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.setTimeout(10000, () => {
        req.destroy(new Error('Firebase bağlantı zaman aşımı (10 sn).'));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  async init() {
    this.cache = this.loadInitialLocalCache();
    this.config = this.loadConfigFromDisk();

    if (this.config.databaseURL) {
      this.status.configured = true;
      this.status.databaseURL = this.config.databaseURL;
      await this.syncFromCloudOrSeed();
      this.startRealtimeStream();
    }
    return this.cache;
  }

  async syncFromCloudOrSeed() {
    try {
      const remote = await this.firebaseRequest('GET', '');
      if (!remote || (!remote.staff && !remote.tasks && !remote.admins)) {
        // Bulut boşsa mevcut yerel veriyi (personeller, raporlar, vardiyalar) Firebase'e yükle!
        await this.firebaseRequest('PUT', '', this.cache);
      } else {
        const prevVer = remote.adminSeedVersion || 0;
        this.cache = this.normalizeDb(remote);
        this.writeLocalBackup();
        if ((this.cache.adminSeedVersion || 0) > prevVer) {
          await this.firebaseRequest('PUT', 'admins', this.cache.admins);
          await this.firebaseRequest('PUT', 'staff', this.cache.staff);
          await this.firebaseRequest('PUT', 'adminSeedVersion', this.cache.adminSeedVersion);
        }
      }
      this.status.connected = true;
      this.status.lastSyncAt = new Date().toISOString();
      this.status.lastError = null;
      this.emit('synced');
    } catch (err) {
      this.status.connected = false;
      this.status.lastError = err.message;
    }
  }

  stopRealtimeStream() {
    clearTimeout(this.reconnectTimer);
    if (this.streamReq) {
      try {
        this.streamReq.destroy();
      } catch (_) {}
      this.streamReq = null;
    }
  }

  startRealtimeStream() {
    this.stopRealtimeStream();
    if (!this.config.databaseURL) return;

    const connectUrl = (targetUrlStr, redirectDepth = 0) => {
      if (redirectDepth > 4) return;
      const u = new URL(targetUrlStr);
      const req = https.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: 'GET',
          headers: { Accept: 'text/event-stream' }
        },
        (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            connectUrl(res.headers.location, redirectDepth + 1);
            return;
          }
          if (res.statusCode !== 200) {
            this.status.connected = false;
            this.status.lastError = `Stream HTTP ${res.statusCode}`;
            res.resume();
            this.scheduleReconnect();
            return;
          }

          this.status.connected = true;
          this.status.lastError = null;
          res.setEncoding('utf8');

          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk;
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
              this.handleSseBlock(block);
            }
          });

          res.on('end', () => {
            this.status.connected = false;
            this.scheduleReconnect();
          });
        }
      );

      req.on('error', (err) => {
        this.status.connected = false;
        this.status.lastError = err.message;
        this.scheduleReconnect();
      });

      req.end();
      this.streamReq = req;
    };

    connectUrl(this.buildFirebaseUrl(''));
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    if (!this.config.databaseURL) return;
    this.reconnectTimer = setTimeout(() => {
      this.startRealtimeStream();
    }, 4000);
  }

  handleSseBlock(block) {
    const lines = block.split('\n');
    let eventType = '';
    let dataStr = '';
    for (const ln of lines) {
      if (ln.startsWith('event:')) eventType = ln.slice(6).trim();
      else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
    }
    if (!dataStr || dataStr === 'null') return;
    if (eventType !== 'put' && eventType !== 'patch') return;

    try {
      const payload = JSON.parse(dataStr);
      if (!payload || typeof payload.path !== 'string') return;
      this.applyRemoteDelta(eventType, payload.path, payload.data);
      this.status.connected = true;
      this.status.lastSyncAt = new Date().toISOString();
      this.writeLocalBackup();
      this.emit('remote_change', { path: payload.path });
    } catch (_) {}
  }

  applyRemoteDelta(eventType, deltaPath, data) {
    if (deltaPath === '/' || deltaPath === '') {
      if (eventType === 'put') {
        if (data && typeof data === 'object') {
          this.cache = this.normalizeDb(data);
        }
      } else if (eventType === 'patch' && data && typeof data === 'object') {
        this.cache = this.normalizeDb({ ...this.cache, ...data });
      }
      return;
    }

    const parts = deltaPath.split('/').filter(Boolean);
    let cursor = this.cache;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    const lastKey = parts[parts.length - 1];
    if (eventType === 'put') {
      if (data === null) {
        delete cursor[lastKey];
      } else {
        cursor[lastKey] = data;
      }
    } else if (eventType === 'patch' && data && typeof data === 'object') {
      cursor[lastKey] = { ...(cursor[lastKey] || {}), ...data };
    }
    this.cache = this.normalizeDb(this.cache);
  }

  getDb() {
    if (!this.cache) {
      this.cache = this.loadInitialLocalCache();
    }
    return this.cache;
  }

  saveDb(db, subPath = '', subVal = undefined) {
    this.cache = this.normalizeDb(db);
    this.writeLocalBackup();

    if (this.config.databaseURL) {
      const targetPath = subPath || '';
      const payload = subPath ? subVal : this.cache;
      this.firebaseRequest('PUT', targetPath, payload)
        .then(() => {
          this.status.connected = true;
          this.status.lastSyncAt = new Date().toISOString();
          this.status.lastError = null;
        })
        .catch((err) => {
          this.status.connected = false;
          this.status.lastError = err.message;
        });
    }
  }

  async configureAndConnect({ databaseURL, authSecret }) {
    const cleanedUrl = this.cleanDbUrl(databaseURL);
    if (!cleanedUrl || !cleanedUrl.startsWith('https://')) {
      throw new Error('Lütfen geçerli bir Firebase Realtime Database URL girin (https://...firebaseio.com veya .firebasedatabase.app).');
    }

    const prevConfig = { ...this.config };
    this.config = {
      databaseURL: cleanedUrl,
      authSecret: authSecret ? String(authSecret).trim() : ''
    };

    try {
      const remote = await this.firebaseRequest('GET', '');
      if (!remote || (!remote.staff && !remote.tasks && !remote.admins)) {
        // Mevcut yerel verileri Firebase'e aktar!
        await this.firebaseRequest('PUT', '', this.cache);
      } else {
        const prevVer = remote.adminSeedVersion || 0;
        this.cache = this.normalizeDb(remote);
        this.writeLocalBackup();
        if ((this.cache.adminSeedVersion || 0) > prevVer) {
          await this.firebaseRequest('PUT', 'admins', this.cache.admins);
          await this.firebaseRequest('PUT', 'staff', this.cache.staff);
          await this.firebaseRequest('PUT', 'adminSeedVersion', this.cache.adminSeedVersion);
        }
      }
    } catch (err) {
      this.config = prevConfig;
      throw new Error(
        `Firebase bağlantısı başarısız: ${err.message}. (Realtime Database kurallarının açık olduğundan veya Database Secret girdiğinizden emin olun.)`
      );
    }

    this.ensureDirs();
    fs.writeFileSync(this.userConfigFile, JSON.stringify(this.config, null, 2), 'utf8');
    // Geliştirme dizinindeysek .exe içine gömülebilmesi için ana firebase-config.json'a da kaydet
    try {
      const rootCfg = path.join(this.bundledDir, 'firebase-config.json');
      if (!this.bundledDir.includes('app.asar')) {
        fs.writeFileSync(rootCfg, JSON.stringify(this.config, null, 2), 'utf8');
      }
    } catch (_) {}

    this.status = {
      configured: true,
      connected: true,
      databaseURL: this.config.databaseURL,
      lastSyncAt: new Date().toISOString(),
      lastError: null
    };
    this.startRealtimeStream();
    return this.status;
  }

  getStatus() {
    return {
      ...this.status,
      hasAuthSecret: Boolean(this.config.authSecret)
    };
  }
}

module.exports = { FirebaseSyncStore };
