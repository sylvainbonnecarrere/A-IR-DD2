const { MongoClient } = require('mongodb');
const path = require('path');
const dotenv = require('dotenv');

// Charger .env depuis le dossier parent
const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.error('❌ Erreur de chargement .env:', result.error);
    process.exit(1);
}

const uri = process.env.MONGO_URI;

console.log('🔍 Diagnostic Connexion MongoDB');
console.log('--------------------------------');
console.log(`📂 Fichier .env : ${envPath}`);
console.log(`🔗 URI configuré : ${uri ? uri.replace(/:([^:@]+)@/, ':****@') : 'NON DÉFINI'}`);

if (!uri) {
    console.error('❌ MONGO_URI manquant dans .env');
    process.exit(1);
}

async function testConnection() {
    console.log('\n🔄 Tentative de connexion directe...');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

    try {
        await client.connect();
        const db = client.db('admin');
        const buildInfo = await db.command({ buildInfo: 1 });
        
        console.log('✅ AUTHENTIFICATION RÉUSSIE !');
        console.log(`   📦 Version MongoDB : ${buildInfo.version}`);
        console.log(`   🖥️  Système Hôte   : ${buildInfo.sysInfo || buildInfo.os?.name || 'Inconnu'}`);
        
        if (buildInfo.os && buildInfo.os.name && buildInfo.os.name.toLowerCase().includes('windows')) {
            console.warn('\n⚠️  ATTENTION : Vous êtes connecté à un MongoDB Windows local, PAS au Docker !');
            console.warn('   C\'est la cause de vos problèmes. Arrêtez le service Windows "MongoDB Server".');
        }
        
        await client.close();
    } catch (error) {
        console.error('❌ ÉCHEC AUTHENTIFICATION');
        console.error(`   Message : ${error.message}`);
        console.error(`   Code    : ${error.code}`);
        
        if (error.code === 18) {
            console.log('\n💡 ANALYSE : Le serveur répond mais refuse le mot de passe.');
            console.log('   Si vous avez un MongoDB local installé sur Windows, il bloque le port 27017.');
        }
    }
}

testConnection();