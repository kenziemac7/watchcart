const API = 'http://localhost:3000';

// Domains that are recognizable shopping sites — used to show the add banner
const SHOPPING_DOMAINS = [
  // Department & multi-brand
  'amazon', 'nordstrom', 'macys', 'bloomingdales', 'neimanmarcus', 'saks',
  'target', 'walmart', 'bestbuy', 'ebay', 'etsy', 'shopify',
  // Streetwear / sneakers
  'nike', 'adidas', 'newbalance', 'converse', 'vans', 'puma',
  'footlocker', 'finishline', 'jdsports', 'goat', 'stockx', 'flightclub', 'kickscrew',
  // Luxury / contemporary
  'farfetch', 'ssense', 'mrporter', 'net-a-porter', 'matchesfashion', 'mytheresa',
  'revolve', 'shopbop',
  // Casual / everyday
  'gap', 'bananarepublic', 'oldnavy', 'jcrew', 'madewell',
  'uniqlo', 'zara', 'hm.com', 'asos',
  'abercrombie', 'hollister', 'ae.com', 'americaneagle',
  // Lifestyle / outdoor
  'anthropologie', 'freepeople', 'urbanoutfitters',
  'lululemon', 'athleta', 'aritzia',
  'patagonia', 'rei.com', 'columbia',
  // Other
  'zappos', 'reformation', 'everlane', 'cos', 'arket',
];

// ── State ────────────────────────────────────────────────────────────────────
let currentTabUrl = '';
let currentTabIsShop = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const viewList       = document.getElementById('view-list');
const viewAdd        = document.getElementById('view-add');
const itemListEl     = document.getElementById('item-list');
const emptyState     = document.getElementById('empty-state');
const listLoading    = document.getElementById('list-loading');
const listError      = document.getElementById('list-error');
const siteBanner     = document.getElementById('site-banner');
const bannerAddBtn   = document.getElementById('banner-add-btn');
const refreshBtn     = document.getElementById('refresh-btn');
const backBtn        = document.getElementById('back-btn');
const addForm        = document.getElementById('add-form');
const inputUrl       = document.getElementById('input-url');
const inputPrice     = document.getElementById('input-price');
const inputSize      = document.getElementById('input-size');
const formError      = document.getElementById('form-error');
const submitBtn      = document.getElementById('submit-btn');
const submitLabel    = document.getElementById('submit-label');
const submitSpinner  = document.getElementById('submit-spinner');

// ── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    currentTabUrl = tab.url;
    currentTabIsShop = SHOPPING_DOMAINS.some(d => currentTabUrl.includes(d));
    if (currentTabIsShop) siteBanner.classList.remove('hidden');
  }
  showList();
  loadItems();
})();

// ── Navigation ────────────────────────────────────────────────────────────────
function showList() {
  viewList.classList.remove('hidden');
  viewAdd.classList.add('hidden');
}

function showAdd() {
  viewList.classList.add('hidden');
  viewAdd.classList.remove('hidden');
  inputUrl.value = currentTabUrl;
  inputPrice.value = '';
  inputSize.value = '';
  hideFormError();
  inputPrice.focus();
}

refreshBtn.addEventListener('click', loadItems);
backBtn.addEventListener('click', showList);
bannerAddBtn.addEventListener('click', showAdd);

// ── Load & render watchlist ───────────────────────────────────────────────────
async function loadItems() {
  setListState('loading');
  try {
    const res = await fetch(`${API}/items`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const items = await res.json();
    renderItems(items);
    setListState('done');
  } catch (err) {
    setListState('error', `Could not reach WatchCart backend.\n${err.message}`);
  }
}

function setListState(state, msg) {
  listLoading.classList.add('hidden');
  listError.classList.add('hidden');
  emptyState.classList.add('hidden');

  if (state === 'loading') listLoading.classList.remove('hidden');
  if (state === 'error') { listError.textContent = msg; listError.classList.remove('hidden'); }
}

function renderItems(items) {
  itemListEl.innerHTML = '';
  if (items.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  for (const item of items) {
    itemListEl.appendChild(buildCard(item));
  }
}

function buildCard(item) {
  const li = document.createElement('li');
  li.className = 'item-card';
  li.dataset.id = item.id;

  // Image or placeholder
  if (item.product_image_url) {
    const img = document.createElement('img');
    img.className = 'item-img';
    img.src = item.product_image_url;
    img.alt = '';
    img.onerror = () => img.replaceWith(imagePlaceholder());
    li.appendChild(img);
  } else {
    li.appendChild(imagePlaceholder());
  }

  // Name + site
  const nameWrap = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'item-name';
  nameEl.textContent = item.product_name || 'Unknown product';
  const siteEl = document.createElement('div');
  siteEl.className = 'item-site';
  siteEl.textContent = item.site_name || new URL(item.url).hostname;
  nameWrap.appendChild(nameEl);
  nameWrap.appendChild(siteEl);
  li.appendChild(nameWrap);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'item-delete-btn';
  delBtn.title = 'Remove';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', () => deleteItem(item.id, li));
  li.appendChild(delBtn);

  // Meta row: price info + badges
  const meta = document.createElement('div');
  meta.className = 'item-meta';

  const priceEl = document.createElement('span');
  priceEl.className = 'price-info';

  const currentPrice = item.last_checked_price ?? item.original_price;
  if (currentPrice != null) {
    priceEl.innerHTML =
      `<span class="current">$${currentPrice.toFixed(2)}</span>` +
      `<span class="arrow">→</span>` +
      `<span class="target">$${item.target_price.toFixed(2)}</span>`;
  } else {
    priceEl.innerHTML = `<span class="target">Target: $${item.target_price.toFixed(2)}</span>`;
  }
  meta.appendChild(priceEl);

  if (item.size) {
    const sizeBadge = document.createElement('span');
    sizeBadge.className = 'badge badge-size';
    sizeBadge.textContent = item.size;
    meta.appendChild(sizeBadge);
  }

  const statusBadge = document.createElement('span');
  statusBadge.className = `badge badge-${item.status}`;
  statusBadge.textContent = item.status;
  meta.appendChild(statusBadge);

  li.appendChild(meta);
  return li;
}

function imagePlaceholder() {
  const div = document.createElement('div');
  div.className = 'item-img-placeholder';
  div.textContent = '🛍️';
  return div;
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteItem(id, el) {
  el.style.opacity = '0.4';
  try {
    const res = await fetch(`${API}/items/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`${res.status}`);
    el.remove();
    if (itemListEl.children.length === 0) emptyState.classList.remove('hidden');
  } catch (err) {
    el.style.opacity = '';
    alert(`Delete failed: ${err.message}`);
  }
}

// ── Add form ──────────────────────────────────────────────────────────────────
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideFormError();

  const url    = inputUrl.value.trim();
  const price  = parseFloat(inputPrice.value);
  const size   = inputSize.value.trim();

  if (!url)        return showFormError('Please enter a product URL.');
  if (isNaN(price) || price <= 0) return showFormError('Please enter a valid target price.');

  setSubmitting(true);
  try {
    const res = await fetch(`${API}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, target_price: price, size: size || undefined }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `Server error ${res.status}`);
    }

    // Switch back to list and refresh
    showList();
    loadItems();
  } catch (err) {
    showFormError(err.message);
  } finally {
    setSubmitting(false);
  }
});

function setSubmitting(on) {
  submitBtn.disabled = on;
  submitLabel.classList.toggle('hidden', on);
  submitSpinner.classList.toggle('hidden', !on);
}

function showFormError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}
function hideFormError() {
  formError.textContent = '';
  formError.classList.add('hidden');
}
