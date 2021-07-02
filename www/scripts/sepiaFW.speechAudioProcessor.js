//WEBSOCKET SPEECH RECOGNITION V2
function sepiaFW_build_speech_audio_proc(){
	var SpeechRecognition = {};
	var isSocketAsrAllowed = true; 		//read only (change by hand to disable)
	
	//Parameters and states
	
	SpeechRecognition.isWebSocketAsr = true;	//just a type lable for main speech class
	SpeechRecognition.socketURI = SepiaFW.data.get('speech-websocket-uri') || '';		//add your ASR WebSocket server here
	SpeechRecognition.getSocketURI = function(){
		return SpeechRecognition.socketURI;
	}
	SpeechRecognition.setSocketURI = function(socketURI){
		SepiaFW.data.set('speech-websocket-uri', socketURI);
		SpeechRecognition.socketURI = socketURI;
		SpeechRecognition.isAsrSupported = testWebSocketAsrSupport();
		//refresh speech info
		SepiaFW.speech.testAsrSupport();
		//refresh UI
		$('#sepiaFW-menu-stt-socket-url').val(SpeechRecognition.socketURI);
	} 		

	function testWebSocketAsrSupport(){
		return (SepiaFW.webAudio && SepiaFW.webAudio.isStreamRecorderSupported)  
			&& isSocketAsrAllowed;
	}
	
	SpeechRecognition.isAsrSupported = testWebSocketAsrSupport();
	
	//--------------------------------

	var Recognizer = {};
	var _asrLogCallback;

	//equivalent to: new webkitSpeechRecognition()
	SpeechRecognition.getRecognizer = function(logCallback){
		//Events: 
		//audiostart (mic on) -> soundstart (first non-null audio data) -> speechstart (client VAD)
		//-> start (transcriber active) -> result (partial)
		//-> speechend (client or server VAD) -> soundend -> audioend -> result (final) -> end

		_asrLogCallback = logCallback || console.error;		//DEBUG
		
		//TODO: use
		Recognizer.continuous = false;			//NOTE: compared to WebSpeechAPI this usually makes finalResult more agressive/frequent
		Recognizer.interimResults = true;
		Recognizer.lang = SepiaFW.speech.getLanguageForASR();
		Recognizer.maxAlternatives = 1;

		/*
		Recognizer.onsoundstart = function(){}
		Recognizer.onsoundend = function(){}
		*/

		Recognizer.onaudiostart = undefined;
		Recognizer.onspeechstart = undefined;	//NOTE: this will be a few ms behind actual speech
		Recognizer.onstart = undefined;
		Recognizer.onspeechend = undefined;
		Recognizer.onaudioend = undefined;
		Recognizer.onend = undefined;

		Recognizer.onerror = console.error;
		Recognizer.onresult = undefined;
		Recognizer.onnomatch = undefined;

		Recognizer.start = function(){
			startRecording();
		}
		Recognizer.stop =  function(){
			stopRecording();
		}
		Recognizer.abort =  function(){
			abortRecording();
		}

		return Recognizer;
	}

	//--------------------------------

	SpeechRecognition.recognitionModule;

	var maxRecordingMs = 10000;
	var maxRecordingMsNoVad = 5000;
	var maxVadTime = 10000;
	
	var isWaitingToRecord = false;
	var isRecording = false;
	//var recognizerWaitingForResult = false;	//TODO: use
	var abortRecognition = false;

	var asrModuleGateIsOpen = false;
	var startedRecordingAt = 0;

	//build SEPIA Web Audio module for custom socket ASR
	function buildWebSocketAsrModule(){
		var hasVad = !!SepiaFW.audioRecorder.getWebAudioRecorderOptions().vadModule;
		var socketAsrModule = SepiaFW.audioRecorder.createSepiaSttSocketModule(function(msg){
			if (!msg) return;
			if (msg.gate){
				if (msg.gate.isOpen == false && asrModuleGateIsOpen){
					asrModuleGateIsOpen = false;
					//STATE: streamend
					onStreamEnd();
					SepiaFW.audioRecorder.stopIfActive(function(){
						//STATE: audioend
						onAudioEnd();
					});
				}else if (msg.gate.isOpen == true && !asrModuleGateIsOpen){
					//STATE: streamstart
					onStreamStart();
					asrModuleGateIsOpen = true;
				}
			}
			if (msg.recognitionEvent){
				onAsrResult(msg.recognitionEvent);
			}
			//In debug or test-mode the module might send the recording:
			if (msg.output && msg.output.wav){
				SepiaFW.ui.cards.addWaveCardToView(msg.output.wav);
			}
		}, {
			//recorder
			recordBufferLimitMs: hasVad? maxRecordingMs : maxRecordingMsNoVad,
			//server
			socketUrl: SpeechRecognition.getSocketURI(), 	//NOTE: if set to 'debug' it will trigger "dry run" (wav file + pseudo res.)
			clientId: "any",			//TODO: load from settings view
			accessToken: "test1234",	// "	"	 "
			//ASR model
			language: Recognizer.lang,
			continuous: Recognizer.continuous,
			engineOptions: {
				interimResults: Recognizer.interimResults,
				alternatives: Recognizer.maxAlternatives
			}
		});
		return socketAsrModule;
	}
	//open/close wake-word module gate
	function setAsrModuleGateState(state){
		if (!SpeechRecognition.recognitionModule) return;
		SpeechRecognition.recognitionModule.handle.sendToModule({gate: state});
	}

	function onAsrResult(event){
		//STATES: result, nomatch, error

		if (event.name == "result"){
			_asrLogCallback('-LOG- ASR RESULT');
			//TODO: build
			if (Recognizer.onresult) Recognizer.onresult(event);

		}else if (event.name == "nomatch"){
			_asrLogCallback('-LOG- ASR RESULT NOMATCH');
			if (Recognizer.onnomatch){
				Recognizer.onnomatch({
					//TODO: no event?
				});
			}else if (Recognizer.onerror){
				Recognizer.onerror({
					error: "no-speech",	//if there is no 'nospeech' defined we redirect
					timeStamp: new Date().getTime()
				});
			}

		}else if (event.name == "error"){
			//TODO: implement
			_asrLogCallback('-LOG- ASR RESULT ERROR');
			if (Recognizer.onerror) Recognizer.onerror({
				//TODO: build
				error: "",
				timeStamp: new Date().getTime()
			});
			
		}else{
			//TODO: implement
		}
	}

	function onStreamStart(){
		_asrLogCallback('-LOG- ASR STREAM-START');
		if (Recognizer.onstart) Recognizer.onstart({
			//TODO: define event
		});
	}
	function onStreamEnd(ev){
		_asrLogCallback('-LOG- ASR STREAM-END');
		if (Recognizer.onend) Recognizer.onend({
			//TODO: define event
		});
	}

	function onSpeechStart(ev){
		_asrLogCallback('-LOG- REC SPEECH-START');
		if (Recognizer.onspeechstart) Recognizer.onspeechstart({
			//TODO: define event
		});
	}
	function onSpeechEnd(ev){
		if (ev.hitLimit){
			_asrLogCallback('-LOG- REC SPEECH-END - LIMIT');
		}else{
			_asrLogCallback('-LOG- REC SPEECH-END');
		}
		if (Recognizer.onspeechend) Recognizer.onspeechend({
			//TODO: define event
		});
		stopRecording();
	}

	function onAudioStart(ev){
		_asrLogCallback('-LOG- REC AUDIO-START - OPENING ASR');
		if (Recognizer.onaudiostart) Recognizer.onaudiostart({
			//TODO: define event
		});
	}
	function onAudioEnd(ev){
		_asrLogCallback('-LOG- REC AUDIO-END');
		if (Recognizer.onaudioend) Recognizer.onaudioend({
			//TODO: define event
		});
	}

	//handle error
	function onAsrErrorAbort(eventName, msg, sepiaCode){
		_asrLogCallback('-LOG- ASR ERROR - ABORT');
		if (Recognizer.onerror) Recognizer.onerror({
			error: eventName,
			message: msg,
			sepiaCode: sepiaCode,
			timeStamp: new Date().getTime()
		});
	}
	
	//START	
	function startRecording(){
		//TODO: add session ID and on release ignore all messages of previous ID!
		
		//check requirements
		if (!SpeechRecognition.isAsrSupported){
			onAsrErrorAbort("audio-capture", 
				"E00 - Speech recognition not supported by your client :-(");
			return;
		}
		if (!SpeechRecognition.socketURI){
			onAsrErrorAbort("network", 
				"E00 - Speech recognition not activated, please set the STT server for the custom engine first (settings).", 1);
			return;
		}
		/* -- TODO: we skip these for the test phase atm:
		if (!SpeechRecognition.recognitionModule){
			//TODO: what if we killed it on purpose? Automatically recreate?
			SepiaFW.debug.error("STT (Socket) - Missing recognition module.");
			onAsrErrorAbort("audio-capture", 
				"E02 - There was a problem with the audio-capture interface (missing module)!");
			return;
		}
		if (!SepiaFW.audioRecorder.existsWebAudioRecorder()){
			//TODO: create
			return;
		}
		if (!SepiaFW.audioRecorder.webAudioHasCapability("speechRecognition")){
			//TODO: release old and make new recorder
			SepiaFW.debug.error("STT (Socket) - Active processor is missing capability 'speechRecognition'.");
			onAsrErrorAbort("audio-capture", 
				"E02 - There was a problem with the audio-capture interface (missing capability)!");
			return;
		}
		*/

		//for now: always stop and release existing recorders
		_asrLogCallback('-LOG- REC CLEAN-UP');
		SepiaFW.audioRecorder.stopAndReleaseIfActive(function(){
			//TODO: generate new session ID!

			_asrLogCallback('-LOG- REC CREATE');
			SpeechRecognition.recognitionModule = buildWebSocketAsrModule();
			
			SepiaFW.audioRecorder.createWebAudioRecorder({
				vadModule: SepiaFW.audioRecorder.createDefaultVadModule(undefined, function(energy){
					if (energy != undefined){}		//use?
				}, undefined, function(){
					onSpeechStart();
				}, undefined, function(){
					//max speech
					onSpeechEnd({start: vadSequenceStarted, end: vadSequenceEnded, hitLimit: true});
				}, function(vadSequenceStarted, vadSequenceEnded){
					onSpeechEnd({start: vadSequenceStarted, end: vadSequenceEnded, hitLimit: false});
				}, {
						maxSequenceTime: maxVadTime,
						minSequenceTime: 600
				}),
				wakeWordModule: false,								//TODO: allow default ww module?
				speechRecognitionModule: SpeechRecognition.recognitionModule
				//onResamplerMessage: function(msg){}				//NOTE: can be used to check volume
			}, function(audioProcessor, info){
				//on init
				_asrLogCallback('-LOG- REC READY - STARTING');
				//start
				SepiaFW.audioRecorder.startWebAudioRecorder(function(){
					//STATE: audiostart
					onAudioStart();
					setAsrModuleGateState("open");
				});
			}, function(initErr){
				//on init err.
				SepiaFW.debug.error("STT (Socket) - Init. error:", initErr);
				onAsrErrorAbort("audio-capture",
					"E03 - Permission to use microphone was denied or there was a problem with the audio interface!");
			
			}, function(runtimeErr){
				//on runtime err.
				SepiaFW.debug.error("STT (Socket) - Runtime error:", runtimeErr);
				onAsrErrorAbort("audio-capture",
					"E03 - A problem occurred during the audio-capture process!");
				return true;
			});
		});
	}

	function stopRecording(){
		//TODO: fix according to spec
		_asrLogCallback('-LOG- REC STOPPING');
		if (asrModuleGateIsOpen){
			setAsrModuleGateState("close");
			//NOTE: this should trigger stop if gate events still arrive
		}else{
			//AudioRecorder stop
			SepiaFW.audioRecorder.stopIfActive(function(){
				//TODO: what if errorCallback triggers?
				//TODO: and now? just wait for result?
				//STATE: audioend
				onAudioEnd();	//trigger or not?
			});
		}
	}

	function abortRecording(){
		//TODO: end all connections, reset states, don't allow old events
		stopRecording();
	}

	//listen to global events to make sure state is updated correctly
	document.addEventListener("sepia_web_audio_recorder", recoderEventListener);
	function recoderEventListener(e){
		var data = e.detail;
		if (!data || !data.event) return;
		
		//TODO: add correct state resets !!

		/*
		if (data.event == "release" && isListening && !isStopping){
			//reset state
			isStopping = false;
			isListening = false;
			SpeechRecognition.recognitionModule = undefined;

		}else if (data.event == "audioend" && isListening && !isStopping){
			//reset state
			setAsrModuleGateState("close");		//TODO: can this cause a race condition if followed quickly by release?
			isStopping = false;
			isListening = false;
		}
		*/
	}
		
	return SpeechRecognition;
}