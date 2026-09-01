import { shop as proshop } from "./proshop.js";

export const SHOPS = [proshop];

export const findShop = id => SHOPS.find(shop => shop.id === id);
