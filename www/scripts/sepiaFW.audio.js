//AUDIO PLAYER
function sepiaFW_build_audio(sepiaSessionId){
	var AudioPlayer = {};
	var Stream = {};
	var TTS = {};			//TTS parameters for SepiaFW external TTS like Acapela. I've tried to seperate TTS and AudioPlayer as good as possible, but there might be some bugs using both
	var Alarm = {};

	//Sounds
	AudioPlayer.micConfirmSound = 'sounds/coin.mp3';
	AudioPlayer.alarmSound = 'sounds/alarm.mp3'; 		//please NOTE: UI.events is using 'file://sounds/alarm.mp3' for 'cordova.plugins.notification' (is it wokring? Idk)
	AudioPlayer.setCustomSound = function(name, path){
		//system: 'micConfirm', 'alarm'
		var customSounds = SepiaFW.data.getPermanent("deviceSounds") || {};
		customSounds[name] = path;
		SepiaFW.data.setPermanent("deviceSounds", customSounds);
		AudioPlayer.loadCustomSounds(customSounds);
	}
	AudioPlayer.loadCustomSounds = function(sounds){
		var customSounds = sounds || SepiaFW.data.getPermanent("deviceSounds");
		if (customSounds){
			if (customSounds.micConfirm) AudioPlayer.micConfirmSound = customSounds.micConfirm;
			if (customSounds.alarm) AudioPlayer.alarmSound = customSounds.alarm;
		}
	}
	//NOTE: you can use for example 'deviceSounds: { micConfirm: "...", alarm: "..." } in 'settings.js' device section
	
	//Parameters and states:

	var player;				//AudioPlayer for music and stuff
	var player2;			//AudioPlayer for sound effects
	var speaker;			//Player for TTS
	var speakerAudioCtx, speakerSource, speakerGainNode;	//for TTS effects filter

	var doInitAudio = true;			//workaround to activate scripted audio on touch devices
	var audioOnEndFired = false;	//state: prevent doublefireing of audio onend onpause

	//Media Devices Options
	AudioPlayer.mediaDevicesSelected = {
		mic: { "value": "", "name": "Default" },
		player: { "value": "", "name": "Default" },
		tts: { "value": "", "name": "Default" },
		fx: { "value": "", "name": "Default" }
	}
	AudioPlayer.mediaDevicesAvailable = {		//IMPORTANT: deviceId can change any time on client reload. Use label!
		in: {},
		out: {}
	};
	AudioPlayer.refreshAvailableMediaDevices = function(successCallback, errorCallback){
		if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices || !navigator.mediaDevices.getUserMedia) {
			SepiaFW.debug.log("Media-Devices: Device enumeration is not supported on this device.");
			if (errorCallback) errorCallback({
				message: "Media device enumeration not supported",
				name: "NotSupportedError"
			});
			return;
		}
		//List media devices
		var didTimeout = false;
		var timeoutTimer = undefined;
		function enumDevices(successCallb, errorCallb){
			if (didTimeout){
				return;
			}
			navigator.mediaDevices.enumerateDevices()
			.then(function(devices){
				devices.forEach(function(device){
					//console.log(device.kind + ": " + device.label + " id = " + device.deviceId);
					if (device.kind == "audioinput"){
						AudioPlayer.mediaDevicesAvailable.in[device.label] = device.deviceId;
					}else if (device.kind == "audiooutput"){
						AudioPlayer.mediaDevicesAvailable.out[device.label] = device.deviceId;
					}
				});
				if (successCallb) successCallb(AudioPlayer.mediaDevicesAvailable);
			})
			.catch(function(err) {
				SepiaFW.debug.error("Media-Devices: Error in device enumeration -", err.message);
				if (errorCallb) errorCallb({
					message: err.message,
					name: err.name
				});
			});
		};
		timeoutTimer = setTimeout(function(){
			didTimeout = true;
			if (errorCallback) errorCallback({
				message: "Media device enumeration timeout. Permission might require user interaction.",
				name: "TimeoutError"
			});
		}, 8000);
		navigator.mediaDevices.getUserMedia({audio: true, video: false})
		.then(function(stream){
			/* use the stream ? */
			clearTimeout(timeoutTimer);
			enumDevices(successCallback, errorCallback);
		})
		.catch(function(err){
			clearTimeout(timeoutTimer);
			if (errorCallback) errorCallback({
				message: err.message,
				name: err.name		//probably: NotAllowedError or SecurityError
			});
		});
	}
	AudioPlayer.setMediaDeviceForNode = function(mediaNodeType, mediaDevice, successCallback, errorCallback){
		var audioNodeElement;
		if (mediaNodeType == "mic"){
			//mic changes need to happen in web-audio recorder (this can only fail when recorder is created)
			SepiaFW.audioRecorder.setWebAudioConstraint("deviceId", mediaDevice.deviceId);
			SepiaFW.debug.log("Audio - Set sink ID for media-node '" + mediaNodeType + "'. Label:", mediaDevice.label);
			AudioPlayer.mediaDevicesSelected[mediaNodeType] = {name: mediaDevice.label, value: mediaDevice.deviceId};
			if (successCallback) successCallback();
			return;
		}
		else if (mediaNodeType == "player") audioNodeElement = AudioPlayer.getMusicPlayer();
		else if (mediaNodeType == "tts") audioNodeElement = AudioPlayer.getTtsPlayer();
		else if (mediaNodeType == "fx") audioNodeElement = AudioPlayer.getEffectsPlayer();

		if (!audioNodeElement.setSinkId){
			if (errorCallback) errorCallback("This audio-node does not support custom sink IDs.");
		}else{
			audioNodeElement.setSinkId(mediaDevice.deviceId)
			.then(function(){
				if (audioNodeElement.sinkId == mediaDevice.deviceId){
					SepiaFW.debug.log("Audio - Set sink ID for media-node '" + mediaNodeType + "'. Label:", mediaDevice.label);
					AudioPlayer.mediaDevicesSelected[mediaNodeType] = {name: mediaDevice.label, value: mediaDevice.deviceId};
					if (successCallback) successCallback();
				}else{
					SepiaFW.debug.error("Audio - tried to set sink ID but failed! Label: " + mediaDevice.label);	//can this actually happen?
					if (errorCallback) errorCallback("Label: " + mediaDevice.label + " - Message: Failed to set sink ID.");
				}
			}).catch(function(err){
				SepiaFW.debug.error("Audio - sink ID cannot be set. Label: " + mediaDevice.label + " - Error:", err);	//TODO: revert back? delete setting?
				if (errorCallback) errorCallback("Label: " + mediaDevice.label + " - Message: " + err.message);
			});
			/* dispatch event? if we want to use this for CLEXI we may need to wait for connection 
			document.dispatchEvent(new CustomEvent('sepia_info_event', { detail: {	type: "audio", info: { message: "" }}})); */
		}
	}
	AudioPlayer.storeMediaDevicesSetting = function(){
		SepiaFW.data.setPermanent("mediaDevices", AudioPlayer.mediaDevicesSelected);
	}
	AudioPlayer.resetMediaDevicesSetting = function(){
		SepiaFW.data.delPermanent("mediaDevices");	//NOTE: reload client after reset
	}
	AudioPlayer.mediaDevicesSetup = function(successCallback){
		var mediaDevicesStored = SepiaFW.data.getPermanent("mediaDevices") || {};
		var deviceNamesStored = Object.keys(mediaDevicesStored);	//mic, tts, etc...
		if (deviceNamesStored.length > 0){
			//make sure this is worth it to load because it can slow-down start time:
			var customSettingsN = 0;
			for (let i=0; i<deviceNamesStored.length; i++){
				var d = mediaDevicesStored[deviceNamesStored[i]];
				if (d.name && d.name.toLowerCase() != "default" && AudioPlayer.mediaDevicesSelected[deviceNamesStored[i]]){
					customSettingsN++;
				}
			}
			if (customSettingsN > 0){
				function countAndFinish(){
					--customSettingsN;
					if (customSettingsN <= 0 && successCallback) successCallback();
				}
				function restoreAsyncAndCheckComplete(mediaDevicesAvailable, deviceTypeName, deviceLabelToSet){
					//restore sink IDs ... if any
					var deviceId = (deviceTypeName == "mic")? mediaDevicesAvailable.in[deviceLabelToSet] : mediaDevicesAvailable.out[deviceLabelToSet];
					if (deviceId){
						//mic or speaker - we distinguish inside set method
						AudioPlayer.setMediaDeviceForNode(deviceTypeName, {deviceId: deviceId, label: deviceLabelToSet}, countAndFinish, countAndFinish);
					}else{
						//device gone - TODO: what now? remove from storage?
						SepiaFW.debug.error("Audio - sink ID for '" + deviceTypeName + "' cannot be set because ID was not available! Label:", deviceLabelToSet);
						countAndFinish();
					}
				}
				SepiaFW.debug.log("Audio - Restoring media-device settings");
				//first load all available devices
				AudioPlayer.refreshAvailableMediaDevices(function(mediaDevicesAvailable){	//NOTE: same as AudioPlayer.mediaDevicesAvailable
					deviceNamesStored.forEach(function(typeName){
						var d = mediaDevicesStored[typeName];
						//NOTE: we apply SAME criteria as above
						if (d.name && d.name.toLowerCase() != "default" && AudioPlayer.mediaDevicesSelected[typeName]){
							//NOTE: we check the name (label) since deviceId can change
							restoreAsyncAndCheckComplete(mediaDevicesAvailable, typeName, d.name);
						}
					});
				}, function(err){
					SepiaFW.debug.error("Audio - FAILED to restore media-device settings", err);
					if (successCallback) successCallback();		//we still continue
				});
			}else{
				if (successCallback) successCallback();
			}
		}else{
			if (successCallback) successCallback();
		}
	}

	Stream.isPlaying = false;		//state: stream player
	Stream.isLoading = false;
	TTS.isSpeaking = false;			//state: TTS player
	TTS.isLoading = false;
	Alarm.isPlaying = false;		//state: alarm player (special feature of effects player)
	Alarm.isLoading = false;
	Alarm.lastActive = 0;

	AudioPlayer.getMusicPlayer = function(){
		return player;
	}
	AudioPlayer.isMusicPlayerStreaming = function(){
		return player
			&& player.currentTime > 0
			&& !player.paused
			&& !player.ended
			&& player.readyState > 2;
	}
	AudioPlayer.startNextMusicStreamOfQueue = function(successCallback, errorCallback){
		//TODO: Currently the only thing 'player' can do is stream radio or URL, so this will always return ERROR for now.
		if (errorCallback) errorCallback({
			error: "No next stream available",
			status: 1
		});
	}
	AudioPlayer.getEffectsPlayer = function(){
		return player2;
	}
	AudioPlayer.getTtsPlayer = function(){
		return speaker;
	}

	//Try to find out if any music player is active (playing or onHold and waiting to resume)
	AudioPlayer.isAnyAudioSourceActive = function(){
		//Stop internal player
		var isInternalPlayerStreaming = Stream.isLoading || AudioPlayer.isMusicPlayerStreaming() || AudioPlayer.isMainOnHold() || TTS.isPlaying;
		var isYouTubePlayerStreaming = SepiaFW.ui.cards.youTubePlayerGetState() == 1 || SepiaFW.ui.cards.youTubePlayerIsOnHold();
		var isAndroidPlayerStreaming = SepiaFW.ui.isAndroid && SepiaFW.android.lastReceivedMediaData && SepiaFW.android.lastReceivedMediaData.playing 
										&& ((new Date().getTime() - SepiaFW.android.lastReceivedMediaAppTS) < (1000*60*15));		//This is pure guessing ...
		return isInternalPlayerStreaming || isYouTubePlayerStreaming || isAndroidPlayerStreaming;			
	}
	AudioPlayer.getLastActiveAudioStreamPlayer = function(){
		return lastAudioPlayerEventSource;
	}
	
	//controls
	var audioTitle;
	var audioStartBtn;
	var audioStopBtn;
	var audioVolUp;
	var audioVolDown;
	var lastAudioStream = 'sounds/empty.mp3';
	var beforeLastAudioStream = 'sounds/empty.mp3';
	var lastAudioStreamTitle = '';
	var lastAudioPlayerEventSource = '';		//Note: this does not include TTS and effects player
	var mainAudioIsOnHold = false;
	var mainAudioStopRequested = false;
	var orgVolume = 1.0;
	var FADE_OUT_VOL = 0.05; 	//note: on some devices audio is actually stopped so this value does not apply

	//---- broadcasting -----

	AudioPlayer.broadcastAudioEvent = function(source, action, playerObject){
		//stream, effects, tts-player, unknown - start, stop, error, fadeOut, fadeIn
		//android-intent - stop, start
		//youtube-embedded - start, resume, pause, hold
		source = source.toLowerCase();
		action = action.toLowerCase();
		if (source == "stream" || source.indexOf("youtube") >= 0 || source.indexOf("android") >= 0){
			lastAudioPlayerEventSource = source;
		}
		var event = new CustomEvent('sepia_audio_player_event', { detail: {
			source: source,
			action: action
		}});
		document.dispatchEvent(event);
		//console.error("audio event: " + source + " - " + action);
	}
	
	function broadcastAudioRequested(){
		//EXAMPLE: 
		if (audioTitle) audioTitle.textContent = 'Loading ...';
	}
	function broadcastAudioFinished(){
		//EXAMPLE: 
		SepiaFW.animate.audio.playerIdle();
		if (audioTitle.innerHTML === "Loading ...") audioTitle.textContent = "Stopped";
	}
	function broadcastAudioStarted(){
		//EXAMPLE: 
		if (audioTitle) audioTitle.textContent = player.title;
		SepiaFW.animate.audio.playerActive();
	}
	function broadcastAudioError(){
		//EXAMPLE: 
		if (audioTitle) audioTitle.textContent = 'Error';
		SepiaFW.animate.audio.playerIdle();
	}
	function broadcastPlayerVolumeSet(){
	}
	function broadcastPlayerFadeIn(){
		//$('#sepiaFW-chat-output').append('FadeIn'); 		//DEBUG
	}
	function broadcastPlayerFadeOut(){
	}
	
	//-----------------------
	
	//set default parameters for audio
	AudioPlayer.setup = function(readyCallback){
		//get players
		player = document.getElementById('sepiaFW-audio-player');
		player2 = document.getElementById('sepiaFW-audio-player2');
		speaker = document.getElementById('sepiaFW-audio-speaker');
		if (speaker) speaker.setAttribute('data-tts', true);

		//Part 1
		audioSetupPart1(function(){
			//Part 2
			audioSetupPart2(function(){
				//Ready
				if (readyCallback) readyCallback();
			});
		});
	}
	function audioSetupPart1(readyCallback){
		//Media devices
		AudioPlayer.mediaDevicesSetup(readyCallback);
	}
	function audioSetupPart2(readyCallback){
		//modified sounds by user?
		AudioPlayer.loadCustomSounds();
		
		//get player controls
		audioTitle = document.getElementById('sepiaFW-audio-ctrls-title');
		audioStartBtn = document.getElementById('sepiaFW-audio-ctrls-start');
		$(audioStartBtn).off().on('click', function(){
			//test: player.src = "sounds/coin.mp3";
			//player.play();
			if (!AudioPlayer.initAudio(function(){ AudioPlayer.playURL('', player); })){
				AudioPlayer.playURL('', player);
			}
		});
		audioStopBtn = document.getElementById('sepiaFW-audio-ctrls-stop');
		$(audioStopBtn).off().on('click', function(){
			SepiaFW.client.controls.media({
				action: "stop"
			});
		});
		audioVolUp = document.getElementById('sepiaFW-audio-ctrls-volup');
		$(audioVolUp).off().on('click', function(){
			playerSetVolume(playerGetVolume() + 1.0);
		});
		audioVolDown = document.getElementById('sepiaFW-audio-ctrls-voldown');
		$(audioVolDown).off().on('click', function(){
			playerSetVolume(playerGetVolume() - 1.0);
		});
		audioVol = document.getElementById('sepiaFW-audio-ctrls-vol');
		if (audioVol) audioVol.textContent = Math.round(player.volume*10.0);

		if (readyCallback) readyCallback();
	}
		
	//sound init - returns true if it will be executed, false everytime after first call
	AudioPlayer.requiresInit = function(){
		//TODO: is this still up-to-date?
		return (!SepiaFW.ui.isStandaloneWebApp && (SepiaFW.ui.isMobile || SepiaFW.ui.isSafari) && doInitAudio);
	}
	AudioPlayer.initAudio = function(continueCallback){
		//workaround for mobile devices to activate audio by scripts
		if (AudioPlayer.requiresInit()){
			SepiaFW.debug.info('Audio - trying to initialize players');
			SepiaFW.animate.assistant.loading();
			
			setTimeout(function(){ AudioPlayer.playURL('sounds/empty.mp3', player); }, 	  0);
			setTimeout(function(){ AudioPlayer.playURL('sounds/empty.mp3', player2); }, 250);
			setTimeout(function(){ AudioPlayer.playURL('sounds/empty.mp3', speaker); }, 500);
			
			if (SepiaFW.ui.isMobile && SepiaFW.speech){
				setTimeout(function(){ SepiaFW.speech.initTTS(); }, 750);
			}
		
			doInitAudio = false;
			
			//make sure to restore idle state once
			setTimeout(function(){ SepiaFW.animate.assistant.idle('initAudioFinished'); }, 1000);
			
			//recall previous action
			if (continueCallback){
				setTimeout(function(){ continueCallback(); }, 1050);
			}
			return true;
			
		}else{
			return false;
		}
	}

	//TTS voice effects
	var voiceEffects = {
		"volume": {
			id: "volume", name: "Volume", 
			getOptions: function(){ 
				return [{key: "gain", name: "Volume", default: 1.0, range: [0.1, 3.0], step: 0.1}]; 
			},
			applyFun: function(audioCtx, masterGainNode, options, doneCallback){
				if (masterGainNode) masterGainNode.gain.value = options.gain || 1.0;
				masterGainNode.connect(audioCtx.destination);
				if (doneCallback) doneCallback(true);
			}
		},
		"robo_1": {
			id: "robo_1", name: "Robotic Modulator 1", 
			getOptions: function(){ return SepiaFW.audio.effects.getVoiceEffectOptions("robo_1"); },
			applyFun: function(audioCtx, masterGainNode, options, doneCallback){
				SepiaFW.audio.effects.applyVoiceEffect("robo_1", audioCtx, masterGainNode, options, doneCallback);
			}
		}, 
		"highpass_1": {
			id: "highpass_1", name: "High-Pass Filter 1", 
			getOptions: function(){ return SepiaFW.audio.effects.getVoiceEffectOptions("highpass_1"); },
			applyFun: function(audioCtx, masterGainNode, options, doneCallback){
				SepiaFW.audio.effects.applyVoiceEffect("highpass_1", audioCtx, masterGainNode, options, doneCallback);
			}
		}
	}
	var voiceEffectActive = "";

	//set default parameters for TTS
	TTS.setup = function(Settings){
		TTS.playOn = (Settings.playOn)? Settings.playOn : "client"; 		//play TTS on client (can also be played on "server" if available)
		TTS.format = (Settings.format)? Settings.format : "default";		//you can force format to default,OGG,MP3,MP3_CBR_32 and WAV (if using online api)
		//about voices
		TTS.voice = (Settings.voice)? Settings.voice : "default";			//name of the voice used
		TTS.gender = (Settings.gender)? Settings.gender : "default";		//name of gender ("male", "female", "child", "old, "creature")
		TTS.mood = (Settings.mood)? Settings.mood : 5;						//mood state
		TTS.speed = (Settings.speed)? Settings.speed : "1.0";
		TTS.tone = (Settings.tone)? Settings.tone : "1.0";
		TTS.maxChunkLength = (Settings.maxChunkLength)? Settings.maxChunkLength : 600;
		TTS.maxMoodIndex = (Settings.maxMoodIndex)? Settings.maxMoodIndex : 3;
	}

	TTS.setVoiceEffect = function(effectId, options, successCallback, errorCallback){
		var effect = effectId? voiceEffects[effectId] : undefined;
		if (!effectId){
			removeActiveVoiceEffect(successCallback);
		}else if (effect){
			applyVoiceEffect(effect, options, successCallback);
		}else{
			removeActiveVoiceEffect(function(){
				SepiaFW.debug.error("TTS effect for id: " + effectId + " NOT FOUND or NOT AVAILABLE!");
				if (errorCallback) errorCallback({name: "VoiceEffectError", message: "not found or not available for this voice"});
			});
		}
	}
	function applyVoiceEffect(effect, options, doneCallback){
		if (speakerGainNode){
			//clean-up what we can
			speakerGainNode.disconnect();
		}
		speaker.crossOrigin = "anonymous";
		speakerAudioCtx = speakerAudioCtx || SepiaFW.webAudio.createAudioContext({});
		speakerSource = speakerSource || speakerAudioCtx.createMediaElementSource(speaker);
		speakerGainNode = speakerAudioCtx.createGain();
		speakerSource.connect(speakerGainNode);
		effect.applyFun(speakerAudioCtx, speakerGainNode, options, function(){
			voiceEffectActive = effect.id;
			SepiaFW.debug.log("Set TTS effect: " + effect.id + " (" + effect.name + ")");
			if (doneCallback) doneCallback();
		});
	}
	function removeActiveVoiceEffect(doneCallback){
		//NOTE: this is not a "real" clean-up since we cannot get rid of the 'createMediaElementSource' anymore O_o
		//REF: https://github.com/WebAudio/web-audio-api/issues/1202
		if (speakerGainNode){
			speakerGainNode.disconnect();
			speakerGainNode.connect(speakerAudioCtx.destination);
		}
		//speaker.crossOrigin = null;
		voiceEffectActive = "";
		SepiaFW.debug.log("Removed TTS effect");
		if (doneCallback) doneCallback();
	}
	TTS.getAvailableVoiceEffects = function(){
		var effects = [
			{value: "", name: "No effect", effectOptions: []}
		];
		//TODO: return different values depending on selected voice?
		Object.keys(voiceEffects).forEach(function(v){
			var eff = voiceEffects[v];
			effects.push({value: eff.id, name: eff.name, effectOptions: eff.getOptions()});
		});
		return effects;
	}
	TTS.getVoiceEffectForId = function(effectId){
		return voiceEffects[effectId];
	}
	TTS.getActiveVoiceEffectId = function(){
		return voiceEffectActive;
	}

	//use TTS endpoint to generate soundfile and speak answer
	TTS.speak = function(message, onStartCallback, onEndCallback, onErrorCallback){
		//gets URL and calls play(URL)
		TTS.getURL(message, function(audioUrl){
			if (audioUrl.indexOf("/") == 0){
				audioUrl = SepiaFW.config.assistAPI + audioUrl.substring(1);
			}else if (audioUrl.indexOf("tts") == 0){
				audioUrl = SepiaFW.config.assistAPI + audioUrl;
			}
			SepiaFW.debug.info("TTS audio url: " + audioUrl);
			AudioPlayer.playURL(audioUrl, speaker, onStartCallback, onEndCallback, onErrorCallback);
		}, onErrorCallback);		
	}
	TTS.stop = function(){
		AudioPlayer.stop(speaker);
	}

	//STOP all audio
	AudioPlayer.stop = function(audioPlayer){
		if (!audioPlayer) audioPlayer = player;
		if (audioPlayer == player){
			if (Stream.isPlaying){
				audioPlayer.pause(); 		//NOTE: possible race condition here if onPause callback triggers after fadeOutMain (then Stream.isPlaying will be true)
			}else{
				Stream.isLoading = false;
			}
			broadcastAudioFinished();
			mainAudioIsOnHold = false;
			mainAudioStopRequested = true;		//We try to prevent the race-condition with that (1)
			audioPlayer.volume = orgVolume;
		
		}else if (audioPlayer == player2){
			//TODO: ?
			audioPlayer.pause();
		
		}else if (audioPlayer == speaker){
			//TTS
			if (TTS.isSpeaking){
				audioPlayer.pause();
			}else{
				TTS.isLoading = false;
			}
		}
		//SEE AudioPlayer stop button for more, e.g. Android stop
	}
	
	//Fade main audio source in and out and restart if needed
	AudioPlayer.isMainOnHold = function(){
		return mainAudioIsOnHold;
	}
	AudioPlayer.fadeOutMain = function(force){
		//we only trigger this when audio is actually playing ...
		if ((Stream.isPlaying && !mainAudioStopRequested) || force){ 	//NOTE: this relys on successful onPause if "stop" was called before (see race cond. above)
			if (SepiaFW.ui.isMobile && Stream.isPlaying && !mainAudioIsOnHold){
				SepiaFW.debug.info('AUDIO: instant fadeOutMain');
				player.pause(); 		//<-- try without broadcasting, is it save?
			}
			//orgVolume = (player.volume < orgVolume)? orgVolume : player.volume;
			SepiaFW.debug.info('AUDIO: fadeOutMain orgVol=' + orgVolume);
			$(player).stop(); 	//note: this is an animation stop
			$(player).animate({volume: FADE_OUT_VOL}, 300);
			broadcastPlayerFadeOut();
			if (!mainAudioStopRequested){		//(if forced ..) We try to prevent the race-condition with that (2)
				mainAudioIsOnHold = true;
			}
			AudioPlayer.broadcastAudioEvent("stream", "fadeOut", player);
		}
	}
	AudioPlayer.fadeInMainIfOnHold = function(){
		if (mainAudioIsOnHold){
			//fade to original volume
			AudioPlayer.playerFadeToOriginalVolume();
			mainAudioIsOnHold = false;
			AudioPlayer.broadcastAudioEvent("stream", "fadeIn", player);
		}/*else{
			//just restore volume
			SepiaFW.debug.info('AUDIO: fadeInMain - no play just reset vol=' + orgVolume);
			playerSetVolume(orgVolume * 10.0);
		}*/
	}
	//More general functions for fading
	AudioPlayer.isOnHold = function(id){
		return (audioFadeListeners[id]? audioFadeListeners[id].isOnHold() : false);
	}
	AudioPlayer.fadeOut = function(force){
		if ((Stream.isPlaying && !mainAudioStopRequested) || force){
			AudioPlayer.fadeOutMain(force);
		}else{
			//Check manually registered players
			var customPlayerIds = Object.keys(audioFadeListeners);
			for (var i=0; i<customPlayerIds.length; i++){
				//stop on first fade out? There should not be more than one active player
				if (audioFadeListeners[customPlayerIds[i]].onFadeOutRequest(force)){
					SepiaFW.debug.info("AUDIO: fadeOut - player: " + customPlayerIds[i]);
					break;
				}
			}
		}
	}
	AudioPlayer.fadeInIfOnHold = function(){
		if (mainAudioIsOnHold){
			AudioPlayer.fadeInMainIfOnHold();
		}else{
			//Check manually registered players
			var customPlayerIds = Object.keys(audioFadeListeners);
			for (var i=0; i<customPlayerIds.length; i++){
				//stop on first fade in? There should not be more than one active player
				var pId = customPlayerIds[i];
				if (audioFadeListeners[pId].onFadeInRequest){
					SepiaFW.debug.info("AUDIO: fadeInIfOnHold - player: " + pId);
					if (audioFadeListeners[pId].isOnHold()){
						SepiaFW.debug.info("AUDIO: fadeInIfOnHold - triggering onFadeInRequest");
						audioFadeListeners[pId].onFadeInRequest()
						break;
					}
				}
			}
		}
	}
	//Register additional fade listeners
	AudioPlayer.registerNewFadeListener = function(callbackObject){
		if (!callbackObject.id){
			SepiaFW.debug.error("AudioPlayer.registerNewFadeListener - not a valid object to register!");
			//valid obejct example:
			/* {
				id: "youtube",
				isOnHold: myFunA,			(return true/false)
				onFadeOutRequest: myFunB,	(return true/false, param: force)
				onFadeInRequest: myFunC		(return true/false)
			} */
		}else{
			audioFadeListeners[callbackObject.id] = callbackObject;
		}
	}
	AudioPlayer.removeFadeListener = function(id){
		delete audioFadeListeners[id];
	}
	var audioFadeListeners = {};
	
	//player specials

	function playerGetVolume(){
		return Math.round(10.0 * player.volume);
	}
	AudioPlayer.playerGetVolume = playerGetVolume;
	AudioPlayer.getOriginalVolume = function(){
		return Math.round(10.0 * orgVolume);
	}

	function playerSetVolume(newVol){
		var setVol = getValidVolume(newVol)/10.0;
		player.volume = setVol;
		orgVolume = setVol;
		$('#sepiaFW-audio-ctrls-vol').html(Math.floor(setVol*10.0));
		SepiaFW.debug.info('AUDIO: volume set (and stored) to ' + setVol);
		broadcastPlayerVolumeSet();
	}
	function playerSetVolumeTemporary(newVol){
		var setVol = getValidVolume(newVol)/10.0;
		player.volume = setVol;
		SepiaFW.debug.info('AUDIO: volume set temporary (till next fadeIn) to ' + setVol);
	}
	function getValidVolume(volumeIn){
		var vol = 0.5;
		if (volumeIn > 10.0) vol = 10.0;
		else if (volumeIn < 0.0) vol = 0.0;
		else vol = volumeIn;
		return vol;
	}
	AudioPlayer.playerSetVolume = playerSetVolume;
	AudioPlayer.playerSetVolumeTemporary = playerSetVolumeTemporary;
	
	//Set volume safely by checking if its currently faded and set either org. volume only or current AND org.
	AudioPlayer.playerSetCurrentOrTargetVolume = function(newVol){
		if (mainAudioIsOnHold || (SepiaFW.speech.isSpeakingOrListening())){
			var setVol = getValidVolume(newVol)/10.0;
			orgVolume = setVol;
			$('#sepiaFW-audio-ctrls-vol').html(Math.floor(setVol*10.0));
			SepiaFW.debug.info('AUDIO: unfaded volume set to ' + setVol);
			broadcastPlayerVolumeSet();
		}else{
			playerSetVolume(newVol);
		}
	}

	AudioPlayer.playerFadeToOriginalVolume = function(){
		//fade to original volume
		if (SepiaFW.ui.isMobile && !Stream.isPlaying){
			SepiaFW.debug.info('AUDIO: fadeToOriginal - restore play status');
			var lastStream = SepiaFW.audio.getLastAudioStream();
			var lastStreamTitle = (lastStream)? SepiaFW.audio.getLastAudioStreamTitle() : "";
			SepiaFW.audio.playURL(lastStream, ''); 	//<-- potentially looses callBack info here, but since this is stopped
			SepiaFW.audio.setPlayerTitle(lastStreamTitle, '');
		}
		SepiaFW.debug.info('AUDIO: fadeToOriginal - restore vol=' + orgVolume);
		$(player).stop(); 	//note: this is an animation stop
		$(player).animate({volume: orgVolume}, 3000);
		broadcastPlayerFadeIn();
	}

	//--------helpers----------

	//get audio URL
	TTS.getURL = function(message, successCallback, errorCallback){
		var apiUrl = SepiaFW.config.assistAPI + "tts";
		var submitData = {
			text: message,
			lang: ((SepiaFW.speech)? SepiaFW.speech.getLanguage() : SepiaFW.config.appLanguage),
			mood: ((SepiaFW.assistant)? SepiaFW.assistant.getMood() : TTS.mood),
			voice: TTS.voice,
			gender: TTS.gender,
			speed: TTS.speed,
			tone: TTS.tone,
			playOn: TTS.playOn,		//check play on server 
			format: TTS.format		//sound format (e.g. wav file)
		};
		submitData.KEY = SepiaFW.account.getKey(sepiaSessionId);
		submitData.client = SepiaFW.config.getClientDeviceInfo();
		submitData.env = SepiaFW.config.environment;

		//get url
		$.ajax({
			url: apiUrl,
			timeout: 10000,
			type: "POST",
			data: submitData,
			headers: {
				"content-type": "application/x-www-form-urlencoded"
			},
			success: function(response){
				SepiaFW.debug.info("GET_AUDIO SUCCESS: " + JSON.stringify(response));
				if (response.result === "success"){
					if (successCallback) successCallback(response.url);
				}else{
					if (errorCallback) errorCallback();
				}
			},
			error: function(e){
				SepiaFW.debug.info("GET_AUDIO ERROR: " + JSON.stringify(e));
				if (errorCallback) errorCallback();
			}
		});
	}
	TTS.getVoices = function(successCallback, errorCallback){
		var apiUrl = SepiaFW.config.assistAPI + "tts-info";
		var submitData = {};
		submitData.KEY = SepiaFW.account.getKey(sepiaSessionId);
		submitData.client = SepiaFW.config.getClientDeviceInfo();
		submitData.env = SepiaFW.config.environment;

		//get url
		$.ajax({
			url: apiUrl,
			timeout: 10000,
			type: "POST",
			data: submitData,
			headers: {
				"content-type": "application/x-www-form-urlencoded"
			},
			success: function(response){
				SepiaFW.debug.info("GET_VOICES SUCCESS: " + JSON.stringify(response));
				if (response.result === "success"){
					if (successCallback) successCallback(response);
				}else{
					if (errorCallback) errorCallback(response);
				}
			},
			error: function(e){
				SepiaFW.debug.info("GET_VOICES ERROR: " + JSON.stringify(e));
				if (errorCallback) errorCallback(e);
			}
		});
	}
	
	//test same origin - TODO: EXPERIMENTAL
	function testSameOrigin(url) {
		var loc = window.location,
			a = document.createElement('a');
		a.href = url;
		return a.hostname == loc.hostname &&
			   a.port == loc.port &&
			   a.protocol == loc.protocol;
	}
	
	//set title of player
	AudioPlayer.setPlayerTitle = function(newTitle, audioPlayer){
		if (!audioPlayer) audioPlayer = player;
		audioPlayer.title = newTitle;
		if (audioTitle) audioTitle.textContent = newTitle || "SepiaFW audio player";
		if (audioPlayer == player){
			lastAudioStreamTitle = newTitle;
		}
	}

	//get the stream last played
	AudioPlayer.getLastAudioStream = function(){
		return lastAudioStream;
	}
	//get title of last stream played
	AudioPlayer.getLastAudioStreamTitle = function(){
		return lastAudioStreamTitle;
	}
	//resume last stream
	AudioPlayer.resumeLastAudioStream = function(){
		var lastStream = AudioPlayer.getLastAudioStream();
		var lastStreamTitle = (lastStream)? AudioPlayer.getLastAudioStreamTitle() : "";
		if (lastStream){
			AudioPlayer.playURL(lastStream, player);
			AudioPlayer.setPlayerTitle(lastStreamTitle);
			return true;
		}else{
			return false;
		}
	}

	//play audio by url
	AudioPlayer.playURL = function(audioURL, audioPlayer, onStartCallback, onEndCallback, onErrorCallback){
		if (!audioPlayer || audioPlayer === '1' || audioPlayer == 1 || audioPlayer == 'stream'){
			audioPlayer = player;
		}else if (audioPlayer === '2' || audioPlayer == 2 || audioPlayer == 'effects'){
			audioPlayer = player2;
		}else if (audioPlayer === 'tts'){
			audioPlayer = speaker;
		}
		if (audioURL) audioURL = SepiaFW.config.replacePathTagWithActualPath(audioURL);
		
		if (audioURL && audioPlayer == player){
			beforeLastAudioStream = lastAudioStream;
			lastAudioStream = audioURL;
			lastAudioStreamTitle = "";		//we reset this and assume "setTitle" is called after "playUrl"
		}
		if (!audioURL) audioURL = lastAudioStream;
		
		audioOnEndFired = false;
		if (audioPlayer == player){
			broadcastAudioRequested();

			//stop all other audio sources
			if (SepiaFW.client.controls){
				SepiaFW.client.controls.media({
					action: "stop",
					skipFollowUp: true
				});
			}
			Stream.isLoading = true;

		}else if (audioPlayer == player2){
			//TODO: ?
		}else if (audioPlayer == speaker){
			//TODO: more?
			TTS.isLoading = true;
		}

		audioPlayer.preload = 'auto';

		//console.log("Audio-URL: " + audioURL); 		//DEBUG
		audioPlayer.src = audioURL;
		audioPlayer.oncanplay = function() {
			SepiaFW.debug.info("AUDIO: can be played now (oncanplay event)");		//debug
			if (audioPlayer == player){
				Stream.isPlaying = true;
				Stream.isLoading = false;
				broadcastAudioStarted();
				AudioPlayer.fadeInMainIfOnHold();
				mainAudioIsOnHold = false;
				mainAudioStopRequested = false;
			}else if (audioPlayer == player2){
				//TODO: ?
			}else if (audioPlayer == speaker){
				TTS.isSpeaking = true;
				TTS.isLoading = false;
			}
			//callback
			if (onStartCallback) onStartCallback();
			if (audioPlayer == player){
				AudioPlayer.broadcastAudioEvent("stream", "start", audioPlayer);
			}else if (audioPlayer == player2){
				AudioPlayer.broadcastAudioEvent("effects", "start", audioPlayer);
			}else if (audioPlayer == speaker){
				AudioPlayer.broadcastAudioEvent("tts-player", "start", audioPlayer);
			}else{
				AudioPlayer.broadcastAudioEvent("unknown", "start", audioPlayer);
			}
		};
		audioPlayer.onpause = function() {
			if (!audioOnEndFired){
				SepiaFW.debug.info("AUDIO: ended (onpause event)");				//debug
				audioOnEndFired = true;
				if (audioPlayer == player){
					Stream.isPlaying = false;
					Stream.isLoading = false;
					mainAudioStopRequested = false; //from here on we rely on Stream.isPlaying
					broadcastAudioFinished();
					//mainAudioIsOnHold = false; 	//<- set in stop method, here we might actually really want to stop-for-hold
				}else if (audioPlayer == player2){
					//TODO: ?
				}else if (audioPlayer == speaker){
					TTS.isSpeaking = false;
					TTS.isLoading = false;
				}
				//callback
				if (onEndCallback) onEndCallback();
				if (audioPlayer == player){
					AudioPlayer.broadcastAudioEvent("stream", "stop", audioPlayer);
				}else if (audioPlayer == player2){
					AudioPlayer.broadcastAudioEvent("effects", "stop", audioPlayer);
				}else if (audioPlayer == speaker){
					AudioPlayer.broadcastAudioEvent("tts-player", "stop", audioPlayer);
				}else{
					AudioPlayer.broadcastAudioEvent("unknown", "stop", audioPlayer);
				}
			}
		};
		audioPlayer.onended = function(){
			if (!audioOnEndFired){
				SepiaFW.debug.info("AUDIO: ended (onend event)");				//debug
				audioPlayer.pause();
			}
		};
		audioPlayer.onerror = function(error){
			SepiaFW.debug.info("AUDIO: error occured! - code: " + (audioPlayer.error? audioPlayer.error.code : error.name));			//debug
			if (audioPlayer.error && audioPlayer.error.code === 4){
				SepiaFW.ui.showInfo("Cannot play the selected audio stream. Sorry!");		//TODO: localize
			}else if (error && error.name && error.name == "NotAllowedError"){
				SepiaFW.ui.showInfo("Cannot play audio because access was denied! This can happen if the user didn't interact with the client first.");
			}else if (error && error.name){
				SepiaFW.ui.showInfo("Cannot play audio - Error: " + error.name + " (see console for details).");
			}
			if (audioPlayer == player){
				broadcastAudioError();
				mainAudioIsOnHold = false;
				mainAudioStopRequested = false;
				Stream.isPlaying = false;
				Stream.isLoading = false;
			}else if (audioPlayer == player2){
				//TODO: ?
			}else if (audioPlayer == speaker){
				TTS.isSpeaking = false;
				TTS.isLoading = false;
			}
			//callback
			if (onErrorCallback) onErrorCallback();
			if (audioPlayer == player){
				AudioPlayer.broadcastAudioEvent("stream", "error", audioPlayer);
			}else if (audioPlayer == player2){
				AudioPlayer.broadcastAudioEvent("effects", "error", audioPlayer);
			}else if (audioPlayer == speaker){
				AudioPlayer.broadcastAudioEvent("tts-player", "error", audioPlayer);
			}else{
				AudioPlayer.broadcastAudioEvent("unknown", "error", audioPlayer);
			}
		};
		var p = audioPlayer.play();	
		if (p && ('catch' in p)){
			p.catch(function(err){
				SepiaFW.debug.error(err);
				audioPlayer.onerror(err);
			});
		}
	}
	
	//play alarm sound
	AudioPlayer.playAlarmSound = function(onStartCallback, onEndCallback, onErrorCallback, stoppedMedia, skippedN){
		if (skippedN == undefined) skippedN = 0;

		var audioPlayer = player2;
		var alarmSound = AudioPlayer.alarmSound;
		//var emptySound = "sounds/empty.mp3";
		/*
		if (audioPlayer.src !== alarmSound && audioPlayer.src !== emptySound && audioPlayer.src !== ''){
			beforeLastAudioStream = lastAudioStream;
			lastAudioStream = audioPlayer.src;
		}
		*/
		
		//make sure that nothing else is running - hard cut!
		if (skippedN <= 3){
			//let assistant finish
			if (SepiaFW.speech.isSpeaking() || SepiaFW.speech.isRecognizing()){
				setTimeout(function(){
					skippedN++;
					AudioPlayer.playAlarmSound(onStartCallback, onEndCallback, onErrorCallback, stoppedMedia, skippedN);
				}, 3000);
				return;
			}
		}else{
			//force stop
			if (SepiaFW.speech.isSpeaking()){
				SepiaFW.speech.stopSpeech();
			}else if (SepiaFW.speech.isRecognizing()){
				SepiaFW.speech.stopRecognition();
			}
		}
		if (!stoppedMedia){
			stoppedMedia = true;
			//running alarm
			AudioPlayer.stopAlarmSound("playAlarm"); 						//just to be sure
			//running media
			SepiaFW.client.controls.media({action: "stop", skipFollowUp: true});	//TODO: consider restarting media-stream later?
			//running wake-word
			if (SepiaFW.wakeTriggers && SepiaFW.wakeTriggers.isListening()){
				SepiaFW.animate.assistant.loading();
				SepiaFW.wakeTriggers.stopListeningToWakeWords(function(){
					//Use the success-callback here to introduce a proper wait
					skippedN++;
					AudioPlayer.playAlarmSound(onStartCallback, onEndCallback, onErrorCallback, stoppedMedia, skippedN);
				}, function(e){
					//Error
					if (onErrorCallback) onErrorCallback(e);
				});
				return;
			}else{
				//give audio engines some time to react
				setTimeout(function(){
					skippedN++;
					AudioPlayer.playAlarmSound(onStartCallback, onEndCallback, onErrorCallback, stoppedMedia, skippedN);
				}, 1000);
				return;
			}
		}
						
		audioOnEndFired = false;

		audioPlayer.src = alarmSound;
		audioPlayer.preload = 'auto';
		Alarm.isLoading = true;

		audioPlayer.oncanplay = function(){
			SepiaFW.debug.info("AUDIO: can be played now (oncanplay event)");		//debug
			Alarm.isPlaying = true;
			Alarm.isLoading = false;
			Alarm.lastActive = new Date().getTime();
			//callback
			if (onStartCallback) onStartCallback;
			AudioPlayer.broadcastAudioEvent("effects", "start", audioPlayer);
		};
		audioPlayer.onpause = function(){
			if (!audioOnEndFired){
				SepiaFW.debug.info("AUDIO: ended (onpause event)");				//debug
				audioOnEndFired = true;
				Alarm.isPlaying = false;
				Alarm.isLoading = false;
				//reset audio URL
				/*
				audioPlayer.preload = 'none';
				audioPlayer.src = emptySound;
				*/
				//callback
				if (onEndCallback) onEndCallback();
				AudioPlayer.broadcastAudioEvent("effects", "stop", audioPlayer);
				SepiaFW.animate.assistant.idle();
			}
		};
		audioPlayer.onended = function(){
			if (!audioOnEndFired){
				SepiaFW.debug.info("AUDIO: ended (onend event)");				//debug
				audioPlayer.pause();
			}
		};
		audioPlayer.onerror = function(error){
			SepiaFW.debug.info("AUDIO: error occured! - code: " + (audioPlayer.error? audioPlayer.error.code : error.name));			//debug
			if (error && error.name && error.name == "NotAllowedError"){
				SepiaFW.ui.showInfo("Cannot play audio because access was denied! This can happen if the user didn't interact with the client first.");
			}else if (error && error.name){
				SepiaFW.ui.showInfo("Cannot play audio - Error: " + error.name + " (see console for details).");
			}
			Alarm.isPlaying = false;
			Alarm.isLoading = false;
			//reset audio URL
			/*
			audioPlayer.preload = 'none';
			audioPlayer.src = emptySound;
			*/
			//callback
			if (onErrorCallback) onErrorCallback();
			AudioPlayer.broadcastAudioEvent("effects", "error", audioPlayer);
			SepiaFW.animate.assistant.idle();
		};
		var p = audioPlayer.play();
		if (p && ('catch' in p)){
			p.catch(function(err){
				SepiaFW.debug.error(err);
				audioPlayer.onerror(err);
			});
		}
	}
	//STOP alarm
	AudioPlayer.stopAlarmSound = function(source){
		//sources: alwaysOn, playAlarm, toggleMic, cardRemove, notificationClick
		SepiaFW.debug.info("AUDIO: stopping alarm sound.");			//debug
		player2.pause();
		//event
		var now = new Date().getTime();
		if (Alarm.isPlaying || (now - Alarm.lastActive) < 60000){
			//alarm was active the last 60s
			if (source && (source == "alwaysOn" || source == "toggleMic" || source == "cardRemove" || source == "notificationClick")){
				SepiaFW.events.broadcastAlarmStop({});			//NOTE: we have no 'Timer' info here :-|
				Alarm.lastActive = 0;
			}
		}
	}
	
	AudioPlayer.tts = TTS;
	AudioPlayer.alarm = Alarm;
	return AudioPlayer;
}