import { installTicketAuth } from "./modules/ticket-auth.module.js";
import { installTicketApi } from "./modules/ticket-api.module.js";

installTicketAuth(window);
installTicketApi(window);
