import { shop as proshop } from "./proshop.js";
import { shop as mtgwebshop } from "./mtgwebshop.js";
import { shop as pbcards } from "./pbcards.js";
import { shop as mugglealley } from "./mugglealley.js";
import { shop as kelz0r } from "./kelz0r.js";
import { shop as matraws } from "./matraws.js";

export const SHOPS = [proshop, mtgwebshop, pbcards, mugglealley, kelz0r, matraws];

export const findShop = id => SHOPS.find(shop => shop.id === id);
