import { Seller } from "../seller.js";

const SERVICE_ID = "<Service_Id>";
const DELETE_TOKEN = "<Delete_Token>";

await new Seller().deleteService(SERVICE_ID, DELETE_TOKEN);
console.log(`Deleted service ${SERVICE_ID}.`);
