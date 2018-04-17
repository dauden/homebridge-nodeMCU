let request = require('request');
let Service;
let Characteristic;
const DEF_UNITS = "ppm";
const DEF_TIMEOUT = 5000;
const DEF_INTERVAL = 120000;  // in milisecond


module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory("homebridge-nodemcu", "NodeMCU", NodeMCU);
	console.log("NodeMCU: module.exports\r\n");
}
function NodeMCU(log, config) {
	this.log = log;
	
	this.name = config["name"];
	this.serviceName = config.service.replace(/\s/g, '');
	this.characteristics = config["characteristics"];
	this.url = config["url"];
	this.http_method = config["http_method"] || "GET";
	this.timeout = config["timeout"] || DEF_TIMEOUT;
	this.units = config["units"] || DEF_UNITS;
	this.auth = config["auth"];
	this.update_interval = Number( config["update_interval"] || DEF_INTERVAL );
	// Internal variables
	this.last_value = null;
	this.waiting_response = false;
	this.listener = [];
}
NodeMCU.prototype.updateState = function (state) {
	if (this.waiting_response) {
		this.log('waiting response!!!');
		return;
	}

	this.waiting_response = true;
	this.last_value = new Promise((resolve, reject) => {
		var uri = this.url;
		
		if (typeof state !== "undefined"){
			if(this.http_method === "GET")
				uri += "?" + state;
		}
		
		var ops = {
			uri: uri,
			method: this.http_method,
			timeout: this.timeout
		};
		if (this.auth) {
			ops.auth = {
				user: this.auth.user,
				pass: this.auth.pass
			};
		}
		request(ops, (error, res, body) => {
			var value = {};
			if (error) {
				this.log('HTTP bad response (' + ops.uri + '): ' + error.message);
			} 
			else {
				try {
					var response = JSON.parse(body);
					
					for (var index in this.characteristics) {
						var charac = this.characteristics[index].replace(/\s/g, '');
						if(response.hasOwnProperty(charac))
							value[charac] = Number(response[charac]);
						else
							this.log("NodeMCU: " + this.characteristics[index] + " has no information");
					}
					
					if (Object.keys(value).length == 0) {
						throw new Error('NodeMCU: No valid value');
					}
					
					this.log('HTTP successful response');
				} catch (parseErr) {
					this.log('Error processing received information: ' + parseErr.message);
					error = parseErr;
				}
			}
			if (!error) {
				resolve(value);
			} 
			else {
				reject(error);
			}
			this.waiting_response = false;
		});
	}).then((value) => {
		for (var charac in value) {
			this.log("NodeMCU: charac:" + charac + ", value:" + value[charac]);
			this.mservice.getCharacteristic(Characteristic[charac]).updateValue(value[charac], null);
		}
		return value;
	}, (error) => {
		return error;
	});
}

NodeMCU.prototype.getServices = function () {
	this.informationService = new Service.AccessoryInformation();
	this.informationService
	.setCharacteristic(Characteristic.Manufacturer, "@metbosch manufacturer")
	.setCharacteristic(Characteristic.Model, "Model not available")
	.setCharacteristic(Characteristic.SerialNumber, "Not defined");

	switch (this.serviceName) {
		case "Fan": 
			this.mservice = new Service.Fan(this.name); 
			break;
		case "Switch": 
			this.mservice = new Service.Switch(this.name); 
			break;
		default: 
			this.mservice = null;  
			this.log("NodeMCU: service not available yet!");
	}
	
	if(this.characteristics != null) {
		if (typeof this.characteristics === "string")
			this.characteristics = [this.characteristics];
		
		for (var index in this.characteristics) {
			var charac = this.characteristics[index].replace(/\s/g, '');
			if(Characteristic.hasOwnProperty(charac)){
				this.listener[index] = charcHelper(charac);
				
				this.mservice.getCharacteristic(Characteristic[charac]).on('get', this.listener[index].getState.bind(this));
				this.mservice.getCharacteristic(Characteristic[charac]).on('set', this.listener[index].setState.bind(this));		
			}
			else {
				this.log("NodeMCU: " + this.characteristics[index] + " is invalid");
				delete this.characteristics[index];
			}
		}
	}
	else
		this.log("NodeMCU: please set characteristics field in config file");
	
	if (this.update_interval > 0) {
		this.timer = setInterval(this.updateState.bind(this), this.update_interval);
	}
	
	function charcHelper(name){
		return {
			getState: function (callback) {
				this.updateState(); //This sets the promise in last_value
				this.last_value.then((value) => {
					callback(null, value[name]);
					return value;
				}, (error) => {
					callback(error, null);
					return error;
				});
			},
			
			setState: function (state, callback) {
				this.updateState(name + "=" + state); //This sets the promise in last_value
				this.last_value.then((value) => {
					callback(null, value[name]);
					return value;
				}, (error) => {
					callback(error, null);
					return error;
				});
			},
		};
	}
	return [this.informationService, this.mservice];
}
