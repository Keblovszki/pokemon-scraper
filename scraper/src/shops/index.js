import { shop as proshop } from "./proshop.js";
import { shop as mtgwebshop } from "./mtgwebshop.js";
import { shop as pbcards } from "./pbcards.js";
import { shop as mugglealley } from "./mugglealley.js";

export const SHOPS = [proshop, mtgwebshop, pbcards, mugglealley];

export const findShop = id => SHOPS.find(shop => shop.id === id);
