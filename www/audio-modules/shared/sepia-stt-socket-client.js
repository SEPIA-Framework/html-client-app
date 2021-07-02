//SEPIA STT Server Client:

class SepiaSttSocketClient {

	constructor(serverUrl, clientId, accessToken, engineOptions, serverOptions){
		this.serverUrl = (serverUrl || "http://localhost:20741").replace("\/$", "");
		this.socketHost = this.serverUrl.replace(/^(http)/, "ws");
		this.clientId = clientId || "any";
		this.accessToken = accessToken || "test1234";

		if (!engineOptions) engineOptions = {};
		if (!serverOptions) serverOptions = {};

		this.serverVersion = "";
		this.asrEngine = "";
		
		this.availableLanguages = [];
		this.availableModels = [];
		this.availableFeatures = [];
		this.activeOptions = engineOptions || {};
		this.phrases = [];

		this.websocket = undefined;
		this.activeLanguageCode = engineOptions.language || "";
		this.activeAsrModel = engineOptions.model || "";

		this._msgId = 0;

		this.connectionIsOpen = false;
		this.isReadyForStream = false;

		this._onOpen = serverOptions.onOpen || function(){};
		this._onReady = serverOptions.onReady || function(activeOptions){};
		this._onClose = serverOptions.onClose || function(){};
		this._onResult = serverOptions.onResult || function(res){};
		this._onError = serverOptions.onError || function(err){
			console.error("SepiaSttSocketClient ERROR", err);
		};

		this._skipAutoWelcome = serverOptions.skipAutoWelcome;
		this._doDebug = true; //serverOptions.doDebug;		//DEBUG
	}

	log(msg){
		if (this._doDebug){
			console.log("SepiaSttSocketClient", msg);
		}
	}

	//--- HTTP Interface ---

	pingServer(successCallback, errorCallback){
		fetch(this.serverUrl + "/ping")
		.then(function(res){ return res.json(); })
		.then(function(json){
			if (successCallback) successCallback(json);
		})
		.catch(function(err){
			if (errorCallback) errorCallback(err);
		});
	}

	loadServerInfo(successCallback, errorCallback){
		fetch(this.serverUrl + "/settings", {
			method: "GET"
		}).then(function(res){
			if (res.ok){
				return res.json();
			}else{
				if (errorCallback) errorCallback({
					"name": "FetchError", "message": res.statusText, "code": res.status
				});
			}
		}).then(function(json){
			if (json && json.settings){
				this._handleServerSettings(json.settings);
				if (successCallback) successCallback(json.settings);
			}else{
				if (successCallback) successCallback({});
			}
		}).catch(function(err){
			if (errorCallback) errorCallback(err);
		});
	}

	_handleServerSettings(settings){
		this.serverVersion = settings.version;
		this.asrEngine = settings.engine || "";
		this.availableLanguages = settings.languages || [];
		this.availableModels = settings.models || [];
		this.availableFeatures = settings.features || [];
	}

	//--- WebSocket interface ---

	newMessageId(){
		var msgId = ++this._msgId;
		if (msgId > 999999){
			msgId = 1;
		}
		return msgId;
	}

	openConnection(){
		if (this.websocket && this.websocket.readyState == this.websocket.OPEN){
			this._onError({name: "SocketConnectionError", message: "Connection was already OPEN"});
			return false;
		}
		var self = this;
	
		//CREATE
		this.websocket = new WebSocket(this.socketHost);
		
		//ONOPEN
		this.websocket.onopen = function(){
			self.log("Connection OPEN");
			self.connectionIsOpen = true;
			self._onOpen();
			//send welcome
			if (!self._skipAutoWelcome){
				self.sendWelcome();
			}
		}
		//ONCLOSE
		this.websocket.onclose = function(){
			self.log("Connection CLOSED");
			self.connectionIsOpen = false;
			self.isReadyForStream = false;
			self._onClose();
		}
		//ONMESSAGE
		this.websocket.onmessage = function(event){
			if (event && event.data && typeof event.data == "string"){
				self.log("Connection MESSAGE: " + event.data);		//DEBUG
				try {
					self.handleSocketMessage(JSON.parse(event.data));
				}catch(err){
					console.error("SepiaSttSocketClient - MessageParserError", err);
					self.handleSocketError({name: "SocketMessageParserError", message: "Message handler saw invlaid JSON?!"});
				}
			}
		}
		//ONERROR
		this.websocket.onerror = function(error){
			self.handleSocketError(error);
		}

		return true;
	}

	closeConnection(){
		if (this.websocket && this.websocket.readyState == this.websocket.OPEN){
			this.websocket.close();
			return true;
		}else{
			//fail silently?
			return false;
		}
	}

	handleSocketMessage(msgJson){
		if (msgJson.type == "error"){
			this.handleSocketError(msgJson);
		}else{
			//console.log("handleSocketMessage", JSON.stringify(msgJson));	//DEBUG
			
			if (msgJson.type == "ping"){
				//TODO: send only after welcome
				this.sendJson({type: "pong", msg_id: msgJson.msg_id});

			}else if (msgJson.type == "welcome"){
				this.log("Connection WELCOME");
				//read active session/engine options
				this.activeOptions = msgJson.info? msgJson.info.options : {};
				this.activeLanguageCode = this.activeOptions.language || "";
				this.activeAsrModel = this.activeOptions.model || "";
				this.isReadyForStream = true;
				this._onReady(this.activeOptions);
			
			}else if (msgJson.type == "result"){
				this._onResult(msgJson);

			}else if (msgJson.type == "response"){
				//anything?
			}
		}
	}

	handleSocketError(err){
		var error = {};
		if (!err) error = {name: "SocketMessageError", message: "unknown"};
		else if (typeof err == "string") error = {name: "SocketMessageError", message: err};
		else error = {name: (err.name || "SocketMessageError"), message: (err.message || "unknown")};
		this._onError(error);
		//Errors are not acceptable :-p - close in any case
		this.closeConnection();
	}

	sendJson(json){
		if (this.websocket && this.websocket.readyState == this.websocket.OPEN){
			this.websocket.send(JSON.stringify(json));
			return true;
		}else{
			this._onError({name: "SocketConnectionError", message: "Connection is closed. Cannot send message."});
			//throw error?
			return false;
		}
	}
	sendBytes(bufferChunk){
		if (!this.websocket || this.websocket.readyState != this.websocket.OPEN){
			this._onError({name: "SocketConnectionError", message: "Connection is closed. Cannot send message."});
			return false;
		}
		this.websocket.send(bufferChunk);	//this can be a typed array (recommended), view or blob (I guess)
		return true;
	}
	sendMessage(text){
		return this.sendJson({
			"type": "chat",
			"data": {"text": text},
			"msg_id": this.newMessageId()
		});
	}
	sendWelcome(options){
		var optionsToSend = options || this.activeOptions;
		return this.sendJson({
			"type": "welcome",
			"data": optionsToSend,
			"client_id": this.clientId,
			"access_token": this.accessToken,
			"msg_id": this.newMessageId()
		});
	}
	sendAudioEnd(byteLength){
		return this.sendJson({
			"type": "audioend",
			"data": {"byteLength": byteLength},
			"msg_id": this.newMessageId()
		});
	}
}
