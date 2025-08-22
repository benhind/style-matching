// ========================= Inline styles (overlays + states) =========================
(function ensureStyles(){
  if (document.getElementById('streetmatch-style')) return;
  const css = `
  .image-card {
    position: relative;
    border: 3px solid transparent;
    border-radius: 12px;
    overflow: hidden;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .image-card img { display:block; width:100%; height:100%; }

  /* selection = blue */
  .image-card.selected { border-color: #3b82f6; } /* blue-500 */

  /* results */
  .image-card.correct   { border-color: #22c55e; } /* green-500 */
  .image-card.incorrect { border-color: #eab308; } /* yellow-500 */

  .pair-check {
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    display:none; width:56px; height:56px; border-radius:50%;
    background: rgba(0,0,0,0.55);
    color:#fff; font-size:34px; line-height:56px; text-align:center;
    box-shadow:0 4px 16px rgba(0,0,0,0.35);
    pointer-events:none;
  }
  /* show icon for either state */
  .image-card.correct  .pair-check,
  .image-card.incorrect .pair-check { display:block; }
  `;
  const tag = document.createElement('style');
  tag.id = 'streetmatch-style';
  tag.textContent = css;
  document.head.appendChild(tag);
})();

// ========================= Utilities =========================
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const showToast = async (msg, timeout=1600) => {
  const t = qs('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  await sleep(timeout); t.classList.remove('show');
};
function basenameLower(s) {
  return String(s).split('/').pop().trim().toLowerCase();
}

/** Sequence randomizer: unique per batch, caps to available, safe on 0 items */
class SequenceRandomizer {
  constructor(items = []) {
    this.items = Array.from(new Set(items.map(String))); // dedupe manifest
    this._bag = [];
    this._refill();
  }
  _refill() {
    this._bag = this.items.slice();
    for (let i = this._bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this._bag[i], this._bag[j]] = [this._bag[j], this._bag[i]];
    }
  }
  /** Return up to n unique items (no repeats within the returned batch). */
  next(n = 4) {
    const total = this.items.length;
    if (total === 0) return [];
    const target = Math.max(1, Math.min(Math.floor(n) || 1, total));
    const out = [];
    const seen = new Set();

    while (out.length < target) {
      if (this._bag.length === 0) this._refill();

      // find unseen candidate in current bag
      let idx = -1;
      for (let i = this._bag.length - 1; i >= 0; i--) {
        const cand = this._bag[i];
        if (!seen.has(cand)) { idx = i; break; }
      }
      if (idx === -1) {
        // all bag items already used in this batch; reshuffle
        this._refill();
        if (seen.size >= total) break; // safety (shouldn't happen)
        continue;
      }
      const val = this._bag.splice(idx, 1)[0];
      out.push(val);
      seen.add(val);
    }
    return out;
  }
}

// ========================= Theme toggle =========================
(function initTheme() {
  const key = 'streetmatch-theme';
  const saved = localStorage.getItem(key);
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  qs('#themeToggle')?.addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', now);
    localStorage.setItem(key, now);
  });
})();

// ========================= Navigation =========================
qs('#year') && (qs('#year').textContent = new Date().getFullYear());
qs('#startBtn')?.addEventListener('click', () => switchView('gameView'));
qs('#howBtn')?.addEventListener('click', () => {
  const blk = qs('#aboutBlock');
  if (!blk) return;
  blk.style.display = blk.style.display === 'none' ? 'block' : 'none';
});
qs('#brandBtn')?.addEventListener('click', () => switchView('welcomeView'));
function switchView(id) {
  qsa('.view').forEach(v => v.classList.remove('active'));
  qs('#' + id)?.classList.add('active');
}

// ========================= Local Image Provider (manifest-based) =========================
class LocalManifestImageProvider {
  constructor({ manifestUrl = 'images/manifest.json', basePath = 'images/' } = {}) {
    this.manifestUrl = manifestUrl;
    this.basePath = basePath;
    this._list = [];
    this._randomizer = new SequenceRandomizer([]);
    this._ready = this._load();
  }

  _fromArray(arr, source) {
    if (!Array.isArray(arr)) throw new Error('Manifest must be an array of filenames');
    this._list = arr.filter(x => typeof x === 'string' && x.trim());
    console.info(`[Provider] Loaded ${this._list.length} images from ${source}.`);
  }

  async _load() {
    // 1) Prefer JS global (works on file:// if you include images/manifest.js)
    if (Array.isArray(window.LOCAL_IMAGE_MANIFEST)) {
      try {
        this._fromArray(window.LOCAL_IMAGE_MANIFEST, 'window.LOCAL_IMAGE_MANIFEST');
      } catch (e) {
        console.warn('[Provider] LOCAL_IMAGE_MANIFEST invalid; will try JSON.', e);
        await this._loadJsonFallback();
      }
    } else {
      // 2) Try JSON over http/https
      await this._loadJsonFallback();
    }

    // 3) Finalize (no hard-coded fallback)
    if (this._list.length === 0) {
      console.warn('[Provider] No manifest found (JS or JSON). Image list is empty.');
    }
    this._randomizer = new SequenceRandomizer(this._list);
  }

  async _loadJsonFallback() {
    try {
      const res = await fetch(this.manifestUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json();
      this._fromArray(arr, this.manifestUrl);
    } catch (e) {
      console.warn(`[Provider] Failed to load ${this.manifestUrl}.`, e);
      // leave _list empty
    }
  }

  async list(n = 4) {
    await this._ready;
    if (this._list.length === 0) return [];  // explicit “nothing found”
    const picked = this._randomizer.next(n);
    return picked.map(name => {
      const trimmed = String(name).trim();
      return {
        id: basenameLower(trimmed),
        label: trimmed,
        src: this.basePath + trimmed,
        selected: false
      };
    });
  }
}



// ========================= Image Processing Pipeline =========================
class UniformTileProcessor {
  constructor({ mode = 'cover' } = {}) { this.name = 'UniformTile'; this.mode = mode; }
  process(img) { return { ...img, __displayMode: this.mode }; }
}
class ProcessingPipeline {
  constructor(stages = []) { this.stages = stages; }
  apply(list) { return list.map(img => this.stages.reduce((acc, st) => st.process(acc), img)); }
}

// ========================= Layout Manager =========================
class GridLayoutManager {
  constructor(container) { this.container = container; }
  clear() { this.container.innerHTML = ''; }
  render(images, onClick) {
    this.clear();
    for (const img of images) {
      const card = document.createElement('button');
      card.className = 'image-card';
      card.type = 'button';
      card.setAttribute('role', 'gridcell');
      card.setAttribute('aria-pressed', String(!!img.selected));
      card.dataset.id = img.id;

      const tag = document.createElement('img');
      tag.src = img.src;
      tag.alt = img.label || img.id;
      tag.style.objectFit = img.__displayMode === 'contain' ? 'contain' : 'cover';
      card.appendChild(tag);

      const check = document.createElement('div');
      check.className = 'pair-check';
      check.textContent = ''; // neutral by default
      card.appendChild(check);

      card.addEventListener('click', () => onClick(img, card));
      img.el = card;
      this.container.appendChild(card);
    }
  }
  renderEmpty(message = 'No images left. Add more images or update the manifest.') {
    this.clear();
    const div = document.createElement('div');
    div.setAttribute('role', 'note');
    div.style.padding = '24px';
    div.style.textAlign = 'center';
    div.style.opacity = '0.8';
    div.textContent = message;
    this.container.appendChild(div);
  }
}

// ========================= Name-Pair Similarity Service =========================
class NamePairSimilarityService {
  constructor() {
    this.map = new Map();
    this.source = 'window.SIMILARITY_DATA';
    this.lastError = null;
    this.ready = this._load();
  }
  _pairKey(a, b) {
    const A = basenameLower(a);
    const B = basenameLower(b);
    return A <= B ? `${A}|${B}` : `${B}|${A}`;
  }
  async _load() {
    try {
      const data = window.SIMILARITY_DATA;
      if (!Array.isArray(data)) throw new Error('window.SIMILARITY_DATA is missing or not an array');
      for (const row of data) {
        if (!row || !row.image1 || !row.image2) continue;
        const key = this._pairKey(row.image1, row.image2);
        const val = Number(row.similarity);
        if (!Number.isFinite(val)) continue;
        const prev = this.map.get(key);
        if (prev === undefined || val > prev) this.map.set(key, val);
      }
      if (this.map.size === 0) throw new Error('similarity data had 0 usable rows');
    } catch (e) {
      this.lastError = String(e && e.message || e);
      console.warn('[NamePairSimilarityService]', this.lastError);
    }
  }
  async getDetails(a, b) {
    const A = basenameLower(a), B = basenameLower(b);
    const key = this._pairKey(A, B);
    const val = this.map.get(key);
    return { a, b, A, B, key, hit: val !== undefined, value: val ?? -1 };
  }
  async get(a, b) { const d = await this.getDetails(a, b); return d.value; }
}

// ========================= Game Controller =========================
class GameController {
  constructor({ provider, processor, layout, similarity, gridEl, countInput, nextBtn, checkBtn, resetBtn }) {
    this.provider = provider;
    this.processor = processor;
    this.layout = layout;
    this.sim = similarity;
    this.gridEl = gridEl;
    this.countInput = countInput;
    this.nextBtn = nextBtn;
    this.checkBtn = checkBtn;
    this.resetBtn = resetBtn;
    this.images = [];
    this._wire();
  }

  _wire() {
    this.nextBtn?.addEventListener('click', () => this.nextBatch());
    this.checkBtn?.addEventListener('click', () => this.checkAnswer());
    this.resetBtn?.addEventListener('click', () => this.resetSelection(true));
    const gameView = qs('#gameView');
    if (gameView) {
      const observer = new MutationObserver(() => {
        if (gameView.classList.contains('active') && this.images.length === 0) {
          this.nextBatch();
        }
      });
      observer.observe(gameView, { attributes: true, attributeFilter: ['class'] });
    }
  }

  selectedCount() { return this.images.filter(im => im.selected).length; }

  async nextBatch() {
    this.images = [];
    this.layout.clear();
    await this.sim.ready;

    const req = Number(this.countInput?.value);
    const n = Number.isFinite(req) ? Math.max(2, Math.floor(req)) : 2;

    const fresh = await this.provider.list(n); // unique + capped inside
    if (!fresh || fresh.length === 0) {
      this.layout.renderEmpty('No images left. Add more images or update the manifest.');
      showToast('No images left.');
      return;
    }
    if (fresh.length < 2) {
      this.layout.renderEmpty('Not enough images to form a pair. Please add more.');
      showToast('Need at least two images.');
      return;
    }

    const processed = new ProcessingPipeline([this.processor]).apply(fresh);
    this.images = processed;

    this.layout.render(this.images, (img, card) => this.toggleSelect(img, card));
    showToast(`Loaded ${fresh.length} image${fresh.length>1?'s':''}. Pick two, then press “Check answer”.`);
  }

  toggleSelect(img, card) {
    if (!img.selected && this.selectedCount() >= 2) {
      showToast('You can only select two images.');
      return;
    }
    img.selected = !img.selected;
    card.classList.toggle('selected', img.selected);
    card.setAttribute('aria-pressed', String(img.selected));
  }

  resetSelection(clearResults=false) {
    for (const img of this.images) {
      img.selected = false;
      if (img.el) {
        img.el.classList.remove('selected','correct','incorrect','pair-winner');
        const overlay = img.el.querySelector('.pair-check');
        if (overlay) overlay.textContent = ''; // neutral
      }
    }
    if (clearResults) this.gridEl?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async _bestPair() {
    let best = { a: null, b: null, val: -Infinity };
    for (let i = 0; i < this.images.length; i++) {
      for (let j = i + 1; j < this.images.length; j++) {
        const A = this.images[i], B = this.images[j];
        if (A.id === B.id) continue;
        const v = await this.sim.get(A.id, B.id);
        if (v >= 0 && v > best.val) best = { a: A, b: B, val: v };
      }
    }
    return best;
  }

  async checkAnswer() {
    const chosen = this.images.filter(im => im.selected);
    if (chosen.length < 2) { showToast('Pick two images first.'); return; }
    if (chosen.length > 2) { showToast('You can only select two images.'); return; }

    const best = await this._bestPair();
    if (!best.a) { showToast('No similarity info for this batch.'); return; }

    // Clear previous marks
    for (const img of this.images) {
      img.el?.classList.remove('pair-winner','correct','incorrect');
      const ov = img.el?.querySelector('.pair-check');
      if (ov) ov.textContent = '';
    }

    // Sets for comparison
    const userSet = new Set([chosen[0].id, chosen[1].id]);
    const bestSet = new Set([best.a.id, best.b.id]);

    // Mark AI's best pair (green + 😉)
    [best.a, best.b].forEach(cardImg => {
      const el = cardImg.el;
      if (!el) return;
      el.classList.add('pair-winner','correct');
      const ov = el.querySelector('.pair-check');
      if (ov) ov.textContent = '😉';
    });

    // Any selected card that isn't part of AI's best -> yellow + 🤔
    let differsFromAI = false;
    for (const img of chosen) {
      if (!bestSet.has(img.id)) {
        differsFromAI = true;
        img.el?.classList.add('incorrect');          // border yellow via CSS
        const ov = img.el?.querySelector('.pair-check');
        if (ov) ov.textContent = '🤔';               // thoughtful emoji
      }
    }

    // Gentle, positive messaging only
    if (differsFromAI) {
      showToast("Nice pick! AI’s current best guess is highlighted 🤖");
    } else {
      showToast("🎉 This is also what AI believes to be the most similar pair 🎉");
    }
  }
}

// ========================= Bootstrap =========================
(async function main() {
  const provider = new LocalManifestImageProvider({ manifestUrl: 'images/manifest.json', basePath: 'images/' });
  const processor = new UniformTileProcessor({ mode: 'cover' });
  const layout = new GridLayoutManager(qs('#grid'));
  const similarity = new NamePairSimilarityService();

  const game = new GameController({
    provider, processor, layout, similarity,
    gridEl: qs('#grid'),
    countInput: qs('#countInput'),
    nextBtn: qs('#nextBtn'),
    checkBtn: qs('#checkBtn'),
    resetBtn: qs('#resetBtn')
  });

  // expose internals (optional)
  window.__streetMatch = { provider, processor, layout, similarity, game, SequenceRandomizer };
})();
