"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bcrypt = __importStar(require("bcrypt"));
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("../dist/generated/prisma/client.js");
async function main() {
    const adapter = new adapter_pg_1.PrismaPg({
        connectionString: process.env.DATABASE_URL,
    });
    const prisma = new client_1.PrismaClient({ adapter });
    const email = (process.env.ADMIN_EMAIL || 'admin@dabriz.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.admin.upsert({
        where: { email },
        update: { passwordHash },
        create: { email, passwordHash },
    });
    console.log(`Admin ready: ${email}`);
    const clientId = process.env.OAUTH_CRM_CLIENT_ID || 'multi-tenant-crm';
    const clientSecret = process.env.OAUTH_CRM_CLIENT_SECRET || 'crm-dev-client-secret-change-me';
    const redirectUris = (process.env.OAUTH_CRM_REDIRECT_URIS ||
        'http://localhost:3002/auth/sso/callback')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
    const clientSecretHash = await bcrypt.hash(clientSecret, 12);
    await prisma.oAuthClient.upsert({
        where: { clientId },
        update: {
            clientSecretHash,
            name: 'Multi-tenant CRM',
            redirectUris,
        },
        create: {
            clientId,
            clientSecretHash,
            name: 'Multi-tenant CRM',
            redirectUris,
        },
    });
    console.log(`OAuth client ready: ${clientId}`);
    console.log(`Redirect URIs: ${redirectUris.join(', ')}`);
    await prisma.$disconnect();
}
main().catch(async (error) => {
    console.error(error);
    process.exit(1);
});
