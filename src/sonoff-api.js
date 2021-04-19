const axios = require("axios")
class SonoffApi {

    async setWifiConfiguration(ssid, password) {
        let response = await axios.post("http://10.10.7.1/ap_diy", {
            password,
            ssid,
        })
        return response.data.error===0;

    }

    async updateFirmware(sonoffIp, downloadUrl, sha256checksum) {
        if (sha256checksum===null) {
            console.log("I do not know tasmota-lite file hash :(")
            return
        }
        let url = `http://${sonoffIp}:8081/zeroconf/ota_flash`
        let response = await axios.post(url, {
            deviceid: '',
            data: {
                downloadUrl: downloadUrl,
                sha256sum: sha256checksum,
            },
        })
        if (response.data.error===0) {
            return true
        }
        console.log("❌ Error uploading OTA upgrade", response.data)
        return false;
    }

    async info(sonoffIp) {
        let url = `http://${sonoffIp}:8081/zeroconf/info`
        let axiosInstance = axios.create({ timeout: 10000 })
        let response = null
        try {
            response = await axiosInstance.post(url, {
                deviceid: "",
                data: {},
            })
            return response.data;
        } catch (e) {
            console.log(`❌ An error happened getting the information from the device through its API: ${e.message}`)
        }
        return false
    }

    async unlock(sonoffIp) {
        let url = `http://${sonoffIp}:8081/zeroconf/ota_unlock`
        let axiosInstance = axios.create({ timeout: 10000 })
        let response = await axiosInstance.post(url, {
            deviceid: "",
            data: {},
        })

        if (response.data.error===0) {
            return true
        }
        console.log("Error unlocking ota upgrade", response.data)
        return false
    }

}

module.exports = new SonoffApi
