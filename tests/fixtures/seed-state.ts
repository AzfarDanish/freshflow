import type { AppState } from "../../src/lib/types";
import { reconcileRisks } from "../../src/lib/expiry";
export const DEMO_DATE="2026-10-24";
export function createSeedState():AppState {
  const time="2026-10-24T08:00:00.000Z";
  const state:AppState={products:[
    {id:"product-milk",name:"Fresh milk",sku:"MILK",category:"Dairy",unit:"bottles",simulated:true,batches:[
      {id:"MILK-001",productId:"product-milk",quantity:8,expiryDate:"2026-10-25",addedAt:time,simulated:true},
      {id:"MILK-002",productId:"product-milk",quantity:24,expiryDate:"2026-11-15",addedAt:time,simulated:true}]},
    {id:"product-bread",name:"Wholemeal bread",sku:"BREAD",category:"Bakery",unit:"loaves",simulated:true,batches:[
      {id:"BREAD-004",productId:"product-bread",quantity:5,expiryDate:"2026-10-23",addedAt:time,simulated:true}]},
    {id:"product-eggs",name:"Grade A eggs",sku:"EGG",category:"Chilled",unit:"trays",simulated:true,batches:[
      {id:"EGG-018",productId:"product-eggs",quantity:6,expiryDate:"2026-11-05",addedAt:time,simulated:true}]}
  ],recommendations:[],tasks:[],activity:[],invoiceIntakes:[],movements:[],suppliers:[],settings:{thresholdDays:7,demoDate:DEMO_DATE,timeZone:"Asia/Kuala_Lumpur",currency:"MYR"}};
  reconcileRisks(state,time);return state;
}
