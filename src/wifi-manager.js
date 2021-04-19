const wifi = require("node-wifi")
const piWifi = require('pi-wifi');
const isPi = require('detect-rpi');

class WifiManager {
    constructor() {
        this.lastConnectedWifiNetwork = null;
        this.respberryInterfaceName = 'wlan0';

        let interfaceName = process.platform==="darwin" ? "en1":null
        wifi.init({
            iface: interfaceName, // network interface, choose a random wifi interface if set to null
        })

    }

    async connectToWifi(ssid, password) {
        if (isPi()) {
            return new Promise((resolve, reject) => {
                piWifi.connect(ssid, password, (err) => {
                    if (err) {
                        return reject(err.message);
                    }
                    resolve(true)
                });
            })
        }
        await wifi.connect({ ssid, password })
    }

    connectToWifiThatIncludes(includes, name) {
        return new Promise(async (resolve, reject) => {
            let currentConnection = await this.getCurrentWifiConnection();
            if (currentConnection !== null) {
                this.lastConnectedWifiNetwork = currentConnection;

                if (this.lastConnectedWifiNetwork.ssid.includes(includes)) {
                    console.log("Already connected to " + name + " network 👌")
                    this.lastConnectedWifiNetwork = null
                    resolve(currentConnection)
                    return
                }
            }

            console.log("Trying to find " + name + " wifi network")

            // Scan networks
            let networks = await this.scanNetworks();1

            let tasmotaNetwork = networks.find(x => x.ssid.includes(includes))
            if (typeof tasmotaNetwork==="undefined") {
                reject(name + " network not found. Networks found: " + networks.map(x => x.ssid).join(", "))
                return
            }

            console.log(name + " wifi network found: " + tasmotaNetwork.ssid + ". Trying to connect...")
            await this.connectToWifi(tasmotaNetwork.ssid, "12345678")
            resolve(tasmotaNetwork)
        })
    }
    getCurrentWifiConnection() {
        return new Promise(async (resolve, reject) => {
            if (isPi()) {

                piWifi.status(this.respberryInterfaceName, function(err, networksArray) {
                    if (err) {
                        reject(err.message);
                    }
                    if (Array.isArray(networksArray) && networksArray.length > 0) {
                        return resolve(networksArray[0])
                    }
                    if (typeof networksArray.ssid === 'undefined') {
                        return resolve(null)
                    }
                    return resolve(networksArray)

                });
            } else {
                let currentConnections = await wifi.getCurrentConnections()
                if (Array.isArray(currentConnections) && currentConnections.length > 0) {
                    return resolve(currentConnections[0])
                }
                return resolve(null)
            }
        });

    }

    async scanNetworks() {
        if (isPi()) {
            return new Promise((resolve, reject) => {
                piWifi.scan(function(err, networks) {
                    if (err) {
                        reject(err.message);
                    }
                    if (!Array.isArray(networks)) {
                        return resolve([])
                    }
                    return resolve(networks)
                });
            })
        }
        return wifi.scan()
    }

    connectToSonoffWifi() {
        return this.connectToWifiThatIncludes('tasmota_', 'Tasmota');
    }

    connectToIteadWifi() {
        return this.connectToWifiThatIncludes('ITEAD-', 'ITEAD');

    }
}

module.exports = new WifiManager();
