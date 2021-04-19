class Store {
    lastSavedWifiCredentials = null;
    lastConnectedWifiNetwork = null;
    localIp = null;
    sonoffIp = null;
    binChecksumHash = null;
    binSize = 500000;
    publicFolder = './public';
    publicFolderPath = null;

}
module.exports = new Store()
