/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

function activeOrLoggedInOrNothingYet(activeCallback, loggedInCallback, elseCallback){
	//user logged in (or demo-mode)?
	if (("SepiaFW" in window && SepiaFW.client.isActive()) || (SepiaFW.client && SepiaFW.client.isDemoMode())){
		activeCallback();
	//delay until onActive
	}else if ("SepiaFW" in window && SepiaFW.account && SepiaFW.account.getUserId()){
		loggedInCallback();
	//let index.html load first??
	}else{
		elseCallback();
	}
}

var app = {
    // Application Constructor
    initialize: function() {
        this.bindEvents();
    },
    //Bind any events that are required on startup. Common events are:
    //'load', 'deviceready', 'offline', and 'online'.
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
    },
    //deviceready Event Handler
    onDeviceReady: function() {
		//universal links
		universalLinks.subscribe('universalLinkTest', app.onUniversalLink);

		//android intents
		if ('plugins' in window && window.plugins.intentShim){
		    window.plugins.intentShim.getIntent(
		        app.onAndroidIntent,
		        function(){
					console.log('window.plugins.intentShim.getIntent - Failed to get Android launch intent.');
				}
			);
			window.plugins.intentShim.onIntent(app.onAndroidIntent);
			window.plugins.intentShim.registerBroadcastReceiver({
				filterActions: [
					'android.intent.action.ASSIST'
				]},
				app.onAndroidIntent
			);
		}
		
		//local notification
		cordova.plugins.notification.local.on("click", app.onLocalNotification, this);
		
		//load setup function from index.html
		appSetup();
		
		//document.getElementById('sepiaFW-login-box').innerHTML += 'login box ready<br>'; 		//DEBUG
		/* moved to login box action:
		if ("splashscreen" in navigator){
			navigator.splashscreen.hide();
		}
		*/
	},
	
	//universal link events
	onUniversalLink: function(eventData) {
		//clean up first to prevent double-call
		if ("localStorage" in window){
			localStorage.removeItem("sepia-deeplink-intent");
		}

		//check SEPIA state
		activeOrLoggedInOrNothingYet(function(){
			//user active (or demo-mode)?

			//handle universal link
			var requestViaUrl;
			var openView;
			if (eventData.params){
				requestViaUrl = eventData.params.q;
				openView = eventData.params.view;
			}

			//Url request (q)
			if (requestViaUrl){
				SepiaFW.client.handleRequestViaUrl(requestViaUrl);
			}
			//Open view or frame (view)
			if (openView){
				SepiaFW.ui.openViewOrFrame(openView);
			}
			//NOTE: compare to URL parameter actions in index.html

		}, function(){
			//user logged in - delay until onActive
			SepiaFW.client.addOnActiveOneTimeAction(function(){
				app.onUniversalLink(eventData);
			});

		}, function(){
			//let index.html load first??
			
			//update localStorage
			if ("localStorage" in window){
				localStorage.setItem("sepia-deeplink-intent", JSON.stringify(eventData));
			}
			//let index.html appSetup() do the rest
		});
		/* eventData:
		{"url":"https://b07z.net/dl/sepia/index.html","host":"b07z.net","scheme":"https","path":"/dl/sepia/index.html","params":{}}
		{
			"url": "http://myhost.com/news/ul-plugin-released.html?foo=bar#cordova-news",
			"scheme": "http",
			"host": "myhost.com",
			"path": "/news/ul-plugin-released.html",
			"params": {
				"foo": "bar"
			},
			"hash": "cordova-news"
		}
		*/
		//console.log('Universal link test successful! :-) (index)');
		//console.log(JSON.stringify(eventData));
	},

	//on Android Intent
	onAndroidIntent: function(intent){
		//clean up first to prevent double-call
		if ("localStorage" in window){
			localStorage.removeItem("sepia-android-intent");
		}

		//check SEPIA state
		activeOrLoggedInOrNothingYet(function(){
			//user active (or demo-mode)?
			console.log('Action' + JSON.stringify(intent.action));
			var intentExtras = intent.extras;
			if (intentExtras == null)	intentExtras = "No extras in intent";
			console.log('Launch Intent Extras: ' + JSON.stringify(intentExtras));

		}, function(){
			//user logged in - delay until onActive
			SepiaFW.client.addOnActiveOneTimeAction(function(){
				app.onAndroidIntent(intent);
			});

		}, function(){
			//let index.html load first??

			//update localStorage
			if ("localStorage" in window){
				localStorage.setItem("sepia-android-intent", JSON.stringify(intent));
			}
			//let index.html appSetup() do the rest
		});
	},

	//local notification events
	onLocalNotification: function(notification, state) {
		//clean up first to prevent double-call
		if ("localStorage" in window){
			localStorage.removeItem("sepia-local-note");
		}

		//check SEPIA state
		activeOrLoggedInOrNothingYet(function(){
			//user active (or demo-mode)?

			//handle local notification
			if (SepiaFW.events && notification && notification.data){
				if (typeof notification.data == "string" && notification.data.indexOf("{") == 0){
					notification.data = JSON.parse(notification.data);
				}
				//console.log(JSON.stringify(notification));
				SepiaFW.events.handleLocalNotificationClick(notification.data);
			}
			SepiaFW.ui.updateMyView(true, true, 'notification'); 		//TODO: think about this here!

		}, function(){
			//user logged in - delay until onActive
			SepiaFW.client.addOnActiveOneTimeAction(function(){
				app.onLocalNotification(notification);
			});

		}, function(){
			//let index.html load first??
			
			//update localStorage
			if ("localStorage" in window){
				localStorage.setItem("sepia-android-intent", JSON.stringify(notification));
			}
			//let index.html appSetup() do the rest
		});
		/* notification example:
		{"id":10,"title":"Alarm","text":"expired: 5min Alarm","smallIcon":"res://ic_popup_reminder","color":"303030","data":{"type":"alarm","onClickType":"stopAlarmSound","onCloseType":"stopAlarmSound"},"actions":[],"attachments":[],"autoClear":true,"defaults":0,"foreground":false,"groupSummary":false,"launch":true,"led":true,"lockscreen":true,"number":0,"priority":0,"progressBar":{"enabled":false,"value":0,"maxValue":100,"indeterminate":false},"showWhen":true,"silent":false,"trigger":{"type":"calendar"},"vibrate":false,"wakeup":true,"meta":{"plugin":"cordova-plugin-local-notification","version":"0.9-beta.2"}}
		*/
		//console.log('Local notification test successful! :-) (index)');
	}
};

app.initialize();