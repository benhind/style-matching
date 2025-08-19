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
  .image-card.correct  { border-color: #22c55e; } /* green-500 */
  .image-card.incorrect{ border-color: #ef4444; } /* red-500 */

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
    this._index = 0;
    this._ready = this._load();
  }
  async _load() {
    try {
      const res = await fetch(this.manifestUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('No manifest');
      const arr = await res.json();
      if (!Array.isArray(arr)) throw new Error('Manifest must be an array of filenames');
      this._list = arr.filter(x => typeof x === 'string' && x.trim().length > 0);
    } catch (e) {
      this._list = Array.from({ length: 12 }, (_, i) => `img${String(i+1).padStart(2,'0')}.jpg`);
      console.warn('Manifest missing; using fallback names. Provide images/manifest.json.', e);
    }
    this._shuffle(this._list);
  }
  _shuffle(a) { for (let i=a.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } }
  async list(n = 4) {
    await this._ready;
    const out = [];
    for (let i = 0; i < n; i++) {
      const raw = this._list[this._index % this._list.length];
      const trimmed = raw.trim();
      out.push({
        id: basenameLower(trimmed),
        label: trimmed,
        src: this.basePath + trimmed,
        selected: false
      });
      this._index++;
    }
    return out;
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
      check.textContent = '✓';           // default; will flip to ✗ for incorrect
      card.appendChild(check);

      card.addEventListener('click', () => onClick(img, card));
      img.el = card;
      this.container.appendChild(card);
    }
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

    const n = Math.max(3, Math.min(12, Number(this.countInput?.value || 3)));
    const fresh = await this.provider.list(n);
    const processed = new ProcessingPipeline([this.processor]).apply(fresh);
    this.images = processed;

    this.layout.render(this.images, (img, card) => this.toggleSelect(img, card));
    showToast(`Loaded ${n} image${n>1?'s':''}. Pick two, then press “Check answer”.`);
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
        if (overlay) overlay.textContent = '✓'; // reset icon
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
      if (ov) ov.textContent = '✓';
    }

    // Sets for comparison
    const userSet = new Set([chosen[0].id, chosen[1].id]);
    const bestSet = new Set([best.a.id, best.b.id]);

    // Mark best pair as correct (green + check)
    [best.a, best.b].forEach(cardImg => {
      const el = cardImg.el;
      if (!el) return;
      el.classList.add('pair-winner','correct');
      const ov = el.querySelector('.pair-check');
      if (ov) ov.textContent = '✓';
    });

    // Any selected card that isn't part of the best pair -> red + cross
    let hadIncorrect = false;
    for (const img of chosen) {
      if (!bestSet.has(img.id)) {
        hadIncorrect = true;
        img.el?.classList.add('incorrect');          // border red
        const ov = img.el?.querySelector('.pair-check');
        if (ov) ov.textContent = '✗';                // cross icon
      }
    }

    showToast(hadIncorrect ? 'Not quite — best pair in green; your wrong pick marked in red.' : 'Correct!');
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

  window.__streetMatch = { provider, processor, layout, similarity, game };
})();