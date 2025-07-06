require('dotenv').config()

const PORT = process.env.PORT;

const MONGODB_URI = process.env.NODE_ENV === 'test'
    ? process.env.TEST_MONGODB_URI
    : process.env.MONGODB_URI

const DEVSHOPID = process.env.DEVSHOPID
const KFM_PASSWORD = process.env.KFM_PASSWORD
const UPLAND_URI = process.env.UPLAND_URI

module.exports = 
{
    PORT,
    MONGODB_URI,
    DEVSHOPID,
    KFM_PASSWORD,
    UPLAND_URI
}