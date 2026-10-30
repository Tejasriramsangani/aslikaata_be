const { MongoClient } = require('mongodb');

// One-off repair: completes a partially seeded catalog (e.g. categories exist
// but products or rates are missing). Mirrors CatalogService.ensureDefaultCatalog.
const SEED = [
  {
    category: { name: 'Paper', code: 'PAPER', displayOrder: 1 },
    products: [
      { name: 'Newspaper', code: 'NEWSPAPER', ratePaise: 1400 },
      { name: 'Cardboard / Carton', code: 'CARDBOARD', ratePaise: 900 },
      { name: 'White Office Paper', code: 'WHITE_PAPER', ratePaise: 1200 },
      { name: 'Magazines & Books', code: 'MAGAZINES', ratePaise: 1000 },
    ],
  },
  {
    category: { name: 'Metal', code: 'METAL', displayOrder: 2 },
    products: [
      { name: 'Iron / Loha', code: 'IRON', ratePaise: 2800 },
      { name: 'Copper / Tamba', code: 'COPPER', ratePaise: 65000 },
      { name: 'Brass / Peetal', code: 'BRASS', ratePaise: 42000 },
      { name: 'Aluminium', code: 'ALUMINIUM', ratePaise: 14000 },
      { name: 'Stainless Steel', code: 'STEEL', ratePaise: 4500 },
    ],
  },
  {
    category: { name: 'Plastic', code: 'PLASTIC', displayOrder: 3 },
    products: [
      { name: 'PET Bottles', code: 'PET_BOTTLE', ratePaise: 1500 },
      { name: 'Hard Plastic', code: 'HARD_PLASTIC', ratePaise: 1200 },
      { name: 'Polythene & Soft Plastic', code: 'SOFT_PLASTIC', ratePaise: 600 },
    ],
  },
  {
    category: { name: 'E-Waste', code: 'E_WASTE', displayOrder: 4 },
    products: [
      { name: 'E-Waste / Electronics', code: 'ELECTRONICS', ratePaise: 3000 },
      { name: 'Lead Acid Batteries', code: 'BATTERY', ratePaise: 8000 },
    ],
  },
  {
    category: { name: 'Rubber', code: 'RUBBER', displayOrder: 5 },
    products: [
      { name: 'Tyres & Tubes', code: 'TYRES', ratePaise: 500 },
      { name: 'General Rubber', code: 'GEN_RUBBER', ratePaise: 400 },
    ],
  },
  {
    category: { name: 'Others', code: 'OTHERS', displayOrder: 6 },
    products: [
      { name: 'Beer / Glass Bottles', code: 'GLASS_BOTTLES', ratePaise: 250 },
      { name: 'Mixed Scrap', code: 'MIXED_SCRAP', ratePaise: 300 },
    ],
  },
];

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/aslikaata';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const categories = db.collection('scrapcategories');
  const products = db.collection('scrapproducts');
  const rates = db.collection('scraprates');
  const now = new Date();

  let createdCategories = 0;
  let createdProducts = 0;
  let createdRates = 0;

  for (const group of SEED) {
    let category = await categories.findOne({ code: group.category.code });
    if (!category) {
      const result = await categories.insertOne({
        ...group.category,
        iconUrl: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        __v: 0,
      });
      category = { _id: result.insertedId };
      createdCategories += 1;
    }

    for (const productSeed of group.products) {
      let product = await products.findOne({ code: productSeed.code });
      if (!product) {
        const result = await products.insertOne({
          categoryId: category._id,
          name: productSeed.name,
          code: productSeed.code,
          description: '',
          imageUrl: null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          __v: 0,
        });
        product = { _id: result.insertedId };
        createdProducts += 1;
      }

      const activeRate = await rates.findOne({ productId: product._id, effectiveTo: null });
      if (!activeRate) {
        await rates.insertOne({
          productId: product._id,
          ratePerKg: productSeed.ratePaise,
          marketBenchmarkRate: null,
          marginDelta: null,
          marginType: null,
          effectiveFrom: now,
          effectiveTo: null,
          createdById: 'script_repair',
          createdAt: now,
          updatedAt: now,
          __v: 0,
        });
        createdRates += 1;
      }
    }
  }

  console.log(
    `Catalog repair done: ${createdCategories} categories, ${createdProducts} products, ${createdRates} rates created.`,
  );
  console.log('Totals now:', {
    categories: await categories.countDocuments(),
    products: await products.countDocuments(),
    activeRates: await rates.countDocuments({ effectiveTo: null }),
  });
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
