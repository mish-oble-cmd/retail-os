/**
 * 1E sample catalog — a ~40-product Singapore convenience-store dataset in SGD
 * (roadmap: canonical first client is Singapore, SGD 9% GST tax-inclusive).
 * Pure data, no logic, so it's trivially reviewable and swappable. Prices are
 * integer minor units (SGD cents). Seeded rows are tagged with a sample_batch_id
 * and deleted in one click; they never mix into reports after deletion.
 */

export interface SampleProduct {
  name: string;
  category: string;
  barcode: string;
  /** SGD cents, integer (money-is-integers). */
  price: number;
  stock: number;
}

export interface SampleCatalog {
  categories: string[];
  products: SampleProduct[];
}

export const SAMPLE_CATALOG_SG: SampleCatalog = {
  categories: ['Drinks', 'Snacks', 'Instant Food', 'Household', 'Personal Care'],
  products: [
    { name: 'Kopi-O (canned)', category: 'Drinks', barcode: '8888000000011', price: 180, stock: 48 },
    { name: 'Teh Tarik (canned)', category: 'Drinks', barcode: '8888000000028', price: 190, stock: 48 },
    { name: 'Milo (can)', category: 'Drinks', barcode: '8888000000035', price: 210, stock: 36 },
    { name: '100PLUS (can)', category: 'Drinks', barcode: '8888000000042', price: 170, stock: 60 },
    { name: "Yeo's Chrysanthemum Tea", category: 'Drinks', barcode: '8888000000059', price: 160, stock: 60 },
    { name: 'Bottled Water 500ml', category: 'Drinks', barcode: '8888000000066', price: 90, stock: 96 },
    { name: 'Coca-Cola 320ml', category: 'Drinks', barcode: '8888000000073', price: 150, stock: 72 },
    { name: 'Pokka Green Tea', category: 'Drinks', barcode: '8888000000080', price: 175, stock: 48 },
    { name: 'Maggi Curry Cup', category: 'Instant Food', barcode: '8888000000103', price: 220, stock: 40 },
    { name: 'Maggi Chicken 5-pack', category: 'Instant Food', barcode: '8888000000110', price: 340, stock: 30 },
    { name: 'Koka Laksa Noodles', category: 'Instant Food', barcode: '8888000000127', price: 250, stock: 30 },
    { name: 'Cup Rice Chicken', category: 'Instant Food', barcode: '8888000000134', price: 380, stock: 24 },
    { name: 'Canned Sardines', category: 'Instant Food', barcode: '8888000000141', price: 200, stock: 36 },
    { name: 'Baked Beans', category: 'Instant Food', barcode: '8888000000158', price: 230, stock: 36 },
    { name: 'Kaya Jam', category: 'Instant Food', barcode: '8888000000165', price: 420, stock: 24 },
    { name: 'Gardenia White Bread', category: 'Instant Food', barcode: '8888000000172', price: 300, stock: 20 },
    { name: 'Potato Chips (Original)', category: 'Snacks', barcode: '8888000000202', price: 320, stock: 40 },
    { name: 'Prawn Crackers', category: 'Snacks', barcode: '8888000000219', price: 190, stock: 48 },
    { name: 'Chocolate Wafer', category: 'Snacks', barcode: '8888000000226', price: 130, stock: 60 },
    { name: 'Mentos Roll', category: 'Snacks', barcode: '8888000000233', price: 120, stock: 72 },
    { name: 'Kit Kat 4-finger', category: 'Snacks', barcode: '8888000000240', price: 180, stock: 60 },
    { name: 'Cream Biscuits', category: 'Snacks', barcode: '8888000000257', price: 150, stock: 48 },
    { name: 'Peanuts (packet)', category: 'Snacks', barcode: '8888000000264', price: 140, stock: 48 },
    { name: 'Seaweed Snack', category: 'Snacks', barcode: '8888000000271', price: 200, stock: 36 },
    { name: 'Dried Mango', category: 'Snacks', barcode: '8888000000288', price: 260, stock: 30 },
    { name: 'Gummy Bears', category: 'Snacks', barcode: '8888000000295', price: 170, stock: 48 },
    { name: 'Tissue Box', category: 'Household', barcode: '8888000000301', price: 250, stock: 30 },
    { name: 'Toilet Roll 4-pack', category: 'Household', barcode: '8888000000318', price: 380, stock: 24 },
    { name: 'Dish Soap', category: 'Household', barcode: '8888000000325', price: 320, stock: 24 },
    { name: 'Laundry Powder 1kg', category: 'Household', barcode: '8888000000332', price: 560, stock: 18 },
    { name: 'Garbage Bags (roll)', category: 'Household', barcode: '8888000000349', price: 290, stock: 24 },
    { name: 'AA Batteries 4-pack', category: 'Household', barcode: '8888000000356', price: 480, stock: 20 },
    { name: 'Lighter', category: 'Household', barcode: '8888000000363', price: 100, stock: 60 },
    { name: 'Toothpaste', category: 'Personal Care', barcode: '8888000000400', price: 340, stock: 24 },
    { name: 'Toothbrush', category: 'Personal Care', barcode: '8888000000417', price: 220, stock: 36 },
    { name: 'Bar Soap', category: 'Personal Care', barcode: '8888000000424', price: 160, stock: 48 },
    { name: 'Shampoo Sachet', category: 'Personal Care', barcode: '8888000000431', price: 60, stock: 96 },
    { name: 'Hand Sanitiser 50ml', category: 'Personal Care', barcode: '8888000000448', price: 280, stock: 30 },
    { name: 'Face Mask 5-pack', category: 'Personal Care', barcode: '8888000000455', price: 300, stock: 30 },
    { name: 'Plaster Strips', category: 'Personal Care', barcode: '8888000000462', price: 240, stock: 30 },
    { name: 'Panadol (blister)', category: 'Personal Care', barcode: '8888000000479', price: 350, stock: 24 },
  ],
};
