const BASE_URL = 'https://www.dijipin.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchInitialState(urlPath, retries = 3) {
  const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(fullUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: controller.signal
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(450 * attempt);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) return null;
      const html = await res.text();
      const match = html.match(/<script[^>]*id="__INITIAL_STATE__"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) return null;
      return JSON.parse(match[1]);
    } catch (err) {
      if (attempt < retries) {
        await sleep(450 * attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function runWithConcurrency(items, concurrency, workerFn) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      try {
        results[current] = await workerFn(items[current], current);
      } catch (err) {
        results[current] = { error: err.message };
      }
      await sleep(60);
    }
  });
  await Promise.all(runners);
  return results;
}

function getProductTypeLabel(pt, fallbackGroup) {
  if (pt === 2) return 'Topup';
  if (pt === 0) return 'E-Pin';
  return fallbackGroup || 'Diğer';
}

let lastScanResult = null;
let activeScanPromise = null;

async function scanDijipinOutOfStock(force = false) {
  if (!force && lastScanResult) {
    return lastScanResult;
  }
  if (activeScanPromise) {
    return activeScanPromise;
  }

  activeScanPromise = (async () => {
    const startedAt = Date.now();

    // 1. Topup ve E-Pin ana kategori listelerini çek
    const [topupState, epinState] = await Promise.all([
      fetchInitialState('/oyun-listesi/topup'),
      fetchInitialState('/oyun-listesi/e-pin')
    ]);

    const topupItems = topupState?.specialPageFront?.data?.items || [];
    const epinItems = epinState?.specialPageFront?.data?.items || [];

    const catMap = new Map();
    const registerItems = (items, groupLabel) => {
      for (const it of items) {
        if (!it || !it.seoUrl) continue;
        if (!catMap.has(it.seoUrl)) {
          catMap.set(it.seoUrl, {
            id: it.id,
            name: it.name,
            seoUrl: it.seoUrl,
            imageUrl: it.imageUrl || '',
            groups: [groupLabel]
          });
        } else {
          const existing = catMap.get(it.seoUrl);
          if (!existing.groups.includes(groupLabel)) {
            existing.groups.push(groupLabel);
          }
        }
      }
    };

    registerItems(topupItems, 'Topup');
    registerItems(epinItems, 'E-Pin');

    const uniqueCategories = Array.from(catMap.values());

    // 2. Her kategorinin alt kategorilerini (/oyun/<seoUrl>) çek
    const subcatTasks = [];
    const directProductGroups = [];

    await runWithConcurrency(uniqueCategories, 4, async (cat) => {
      const state = await fetchInitialState(`/oyun/${cat.seoUrl}`);
      if (!state) return;

      const uCats = state?.undercategoryFront?.datasByCategorySeoUrl?.underCategories || [];
      const directProds = state?.productFront?.datasBySeoUrl?.products || [];

      if (uCats.length > 0) {
        for (const uc of uCats) {
          if (!uc || !uc.seoUrl) continue;
          subcatTasks.push({
            cat,
            subcat: {
              id: uc.id,
              name: uc.name || cat.name,
              seoUrl: uc.seoUrl,
              imageUrl: uc.imageUrl || cat.imageUrl,
              productType: uc.productType
            }
          });
        }
      } else if (directProds.length > 0) {
        directProductGroups.push({
          cat,
          subcat: {
            id: cat.id,
            name: cat.name,
            seoUrl: '',
            imageUrl: cat.imageUrl,
            productType: null
          },
          products: directProds
        });
      }
    });

    // 3. Tüm alt kategorilerin ürünlerini (/urunler/<catSeoUrl>/<subSeoUrl>) çek
    const subcatFetched = await runWithConcurrency(subcatTasks, 4, async (task) => {
      const pState = await fetchInitialState(`/urunler/${task.cat.seoUrl}/${task.subcat.seoUrl}`);
      const products = pState?.productFront?.datasBySeoUrl?.products || [];
      return {
        cat: task.cat,
        subcat: task.subcat,
        products
      };
    });

    const allBundles = [...directProductGroups, ...subcatFetched.filter((x) => x && Array.isArray(x.products))];

    // 4. Kategori bazında stoğu biten ürünleri grupla
    let totalScannedProducts = 0;
    let totalOutOfStockProducts = 0;
    const resultByCat = new Map();

    for (const bundle of allBundles) {
      const { cat, subcat, products } = bundle;
      totalScannedProducts += products.length;

      const zeroProducts = products.filter((p) => !p.stock || Number(p.stock) <= 0);
      if (zeroProducts.length === 0) {
        if (resultByCat.has(cat.seoUrl)) {
          resultByCat.get(cat.seoUrl).totalProducts += products.length;
        } else {
          resultByCat.set(cat.seoUrl, {
            ...cat,
            url: `${BASE_URL}/oyun/${cat.seoUrl}`,
            totalProducts: products.length,
            outOfStockCount: 0,
            subcategories: []
          });
        }
        continue;
      }

      totalOutOfStockProducts += zeroProducts.length;
      if (!resultByCat.has(cat.seoUrl)) {
        resultByCat.set(cat.seoUrl, {
          ...cat,
          url: `${BASE_URL}/oyun/${cat.seoUrl}`,
          totalProducts: 0,
          outOfStockCount: 0,
          subcategories: []
        });
      }

      const entry = resultByCat.get(cat.seoUrl);
      entry.totalProducts += products.length;
      entry.outOfStockCount += zeroProducts.length;

      const subUrl = subcat.seoUrl
        ? `${BASE_URL}/urunler/${cat.seoUrl}/${subcat.seoUrl}`
        : `${BASE_URL}/oyun/${cat.seoUrl}`;
      const subTypeLabel = getProductTypeLabel(subcat.productType, cat.groups[0]);

      if ((subTypeLabel === 'Topup' || subTypeLabel === 'E-Pin') && !entry.groups.includes(subTypeLabel)) {
        entry.groups.push(subTypeLabel);
      }

      entry.subcategories.push({
        id: subcat.id,
        name: subcat.name,
        seoUrl: subcat.seoUrl,
        typeLabel: subTypeLabel,
        url: subUrl,
        totalInSubcat: products.length,
        outOfStockProducts: zeroProducts.map((p) => ({
          id: p.iId || p.id,
          name: p.name,
          price: typeof p.price === 'number' ? Number(p.price.toFixed(2)) : p.price,
          currency: p.currencyCodeStr || 'TRY',
          stock: Number(p.stock) || 0,
          imageUrl: p.imageUrl || subcat.imageUrl || cat.imageUrl || '',
          typeLabel: getProductTypeLabel(p.productType, subTypeLabel),
          url: subUrl
        }))
      });
    }

    const outOfStockCategories = Array.from(resultByCat.values())
      .filter((c) => c.outOfStockCount > 0)
      .sort((a, b) => b.outOfStockCount - a.outOfStockCount || a.name.localeCompare(b.name, 'tr'));

    const durationSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));

    lastScanResult = {
      scannedAt: new Date().toISOString(),
      durationSec,
      summary: {
        scannedCategories: uniqueCategories.length,
        scannedSubcategories: allBundles.length,
        scannedProducts: totalScannedProducts,
        affectedCategoriesCount: outOfStockCategories.length,
        totalOutOfStockProducts
      },
      categories: outOfStockCategories
    };

    return lastScanResult;
  })();

  try {
    return await activeScanPromise;
  } finally {
    activeScanPromise = null;
  }
}

function getCachedStockScan() {
  return lastScanResult;
}

module.exports = { scanDijipinOutOfStock, getCachedStockScan };
