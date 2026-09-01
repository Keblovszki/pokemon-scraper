import { shop as proshop } from "./proshop.js";
import { shop as mtgwebshop } from "./mtgwebshop.js";

export const SHOPS = [proshop, mtgwebshop];

export const findShop = id => SHOPS.find(shop => shop.id === id);
