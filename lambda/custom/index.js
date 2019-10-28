/* eslint no-use-before-define: 0 */
// sets up dependencies
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'] // lambda-audioで必須
'use strict';
const Alexa = require('ask-sdk');
const aws = require('aws-sdk');              // S3への保存用
const lambdaAudio = require('lambda-audio'); // ここがキモ
const mp3Duration = require('mp3-duration'); // Pollyの再生時間を取得するのに必要
const fs = require('fs-extra');              // Lambdaのローカルへの読み書きに必要
const crypto = require('crypto');            // SSML文字列からmd5ハッシュ値を取得して、キャッシュのためのファイル名を生成する

// settings
let myRegion = 'ap-northeast-1' // リージョンを指定。この例では東京リージョン。
const myBucket = ''; // s3バケット名を指定してください。

// Pollyの音声と同じフォーマット、つまり48 kb/s・22.050 hz mp3。結構小さめの音にしておかないとPollyの声が聞こえなくなるので注意。
// mp3ファイルをlambda/custom/audio配下において以下で指定してください
const background_sfx = './audio/whales_low_volume.mp3'; 

// PollyとS3の初期化
const s3 = new aws.S3();
const polly = new aws.Polly({
    signatureVersion: 'v4',
    region: myRegion
});

// --- ローカル関数 ----

// soxやlameをlambdaのローカルディスク上にコピーする
async function copyFiles () {
  try {
    await fs.copy('./node_modules/lambda-audio/bin/sox', '/tmp/sox')
    await fs.copy('./node_modules/lambda-audio/bin/lame', '/tmp/lame')
    await fs.chmod('/tmp/sox', '777');
    await fs.chmod('/tmp/lame', '777')
    console.log('success copying and executing sox lame rights!')
  } catch (err) {
    console.error(err)
  }
}

// Pollyで音声を生成してBufferを返す
const generatePollyAudio = (text, voiceId) => {
  let params;
  // Joanna/Matthewの場合にニューラルが使える、そうでない場合は'standard' (ただし動かない）
  if (voiceId === "Joanna" || voiceId === "Matthew") {
    params = {
      //Engine: 'neural', // 認識されない。ap-northeastだから?
      Text: text,
      SampleRate: '22050',
      OutputFormat: 'mp3',
      TextType: 'ssml',
      VoiceId: voiceId // Polly APIで使えるIDのリストは http://docs.aws.amazon.com/fr_fr/polly/latest/dg/API_Voice.html#API_Voice_Contents を参照
    }
  } else {
    params = {
      //Engine: 'standard', // 認識されない。ap-northeastだから?
      Text: text,
      OutputFormat: 'mp3',
      TextType: 'ssml',
      VoiceId: voiceId // Polly APIで使えるIDのリストは http://docs.aws.amazon.com/fr_fr/polly/latest/dg/API_Voice.html#API_Voice_Contents を参照
    }
  }
  
  return polly.synthesizeSpeech(params).promise().then( audio => {
    if (audio.AudioStream instanceof Buffer) return audio
    else throw 'AudioStream is not a Buffer.'
  })
};

// ストリームをS3に保存
const writeAudioStreamToS3Bucket = ( audioStream, filename ) =>
  putObject(myBucket, filename, audioStream, 'audio/mp3').then( res => {
  if(!res.ETag) throw res
  else {
    //previously
    return {
      msg: 'File successfully generated.',
      ETag: res.ETag,
      url: `https://s3-ap-northeast-1.amazonaws.com/${myBucket}/${filename}`
    }
  }
});

// S3に保存
const putObject = (myBucket, key, body, contentType) =>
  s3.putObject({
    Bucket: myBucket,
    Key: key,
    Body: body,
    ContentType: contentType
}).promise();

/** 
 * lambdaAudio.sox -m / で、ファイルをマージして、48 kb/s / 22050 Hzで圧縮。
 * 更にsoxでマージするとクリッピングを防ぐために音量が小さくなるため、"gain -l 16".
 * 最後にPollyの音声の長さに合わせてトリミングする
 * soxのオプション等については http://sox.sourceforge.net/Docs/FAQ を参照
**/
const mix_polly_with_background = (background_mp3, polly_voice_mp3, resulting_mp3, duration) => 
lambdaAudio.sox ('-m '+background_mp3+' '+polly_voice_mp3+' -C 48.01 '+resulting_mp3+' rate 22050 gain -l 16 trim 0 '+duration).then(() => {
        return resulting_mp3
}).catch(err => console.error("mix error: "+err));

/** ココがキモ
 * ssml: <speak>テキスト</speak>
 * voice: Pollyの音声の名前: https://docs.aws.amazon.com/de_de/polly/latest/dg/voicelist.html)
 * background_sound: background_sfx で定義されている、audioフォルダに配置した48kb/s / 22.050 Hzのオーディオファイルが指定される。
 * polly_voice: Lambdaの/tmp/に出力されるPolly音声の一時ファイル名
 * sound_mix_result: SSML/発話/BGMをミックスした結果ファイル、S3に出力される
 **/
async function generatePollyUrl (ssml, voice, background_sound) {
  // SSMLとBGMからmd5ハッシュを求めてファイル名にする
  let sound_mix_result = crypto.createHash('md5').update(ssml + voice + background_sound).digest('hex') + ".mp3";
  console.log("sound mix result filename: "+sound_mix_result);

  try {
    // ファイルが存在したらそのままSSMLを出力
    await s3.headObject({Bucket: myBucket,Key: sound_mix_result}).promise();
    console.log("requested file exists in your s3 bucket. returning the url to the audio tag now.")
    return '<audio src="https://'+myBucket+'.s3-'+myRegion+'.amazonaws.com/'+sound_mix_result+'"/>';;
  } catch (err) {
    // ファイルが存在しなければファイル生成
    console.log("File does not exist. So generating it now." + err);
    // Pollyのmp3用一時ファイル名。/tmp/に出力され、すく削除される
    let polly_voice = "polly_tmp_" + Math.round(+new Date() / 10) + ".mp3";
    console.log("polly voice filename: "+polly_voice);
    if (fs.existsSync('/tmp/sox') && fs.existsSync('/tmp/lame')) { console.log('Found lame and sox file'); }
    else { await copyFiles(); } // sox/lameを/tmpに毎回コピーする（毎回削除されるため）
    const pollyVoice = await generatePollyAudio(ssml, voice); 
    await fs.outputFile('/tmp/' + polly_voice, pollyVoice.AudioStream); // pollyのオーディオストリームを/tmpに出力. /tmpは書き込み可能
    
    // ここからpollyとBGMをミックスする

    const duration = await mp3Duration('/tmp/' + polly_voice); //polly音声の長さを取得する。BGMのほうが長い場合はそちらにあわせてミックスされるため、ここで取得した時間に合わせてBGMがカットされるように。
    var file = await mix_polly_with_background(background_sound, '/tmp/' + polly_voice, '/tmp/' + sound_mix_result, duration); // BGMとPolly音声をミックスして/tmpに出力、あわせてpolly音声の長さにあわせてカット
    const uploadFile = await fs.readFile(file); 

    var writeToS3 = await writeAudioStreamToS3Bucket(uploadFile, sound_mix_result); 
    console.log(writeToS3.url);
    return '<audio src="'+writeToS3.url+'"/>';
  }
}

// LaunchRequestから実行
const LaunchHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    console.log("LaunchHandler: canHandle ");
    return request.type === 'LaunchRequest';

  },
  async handle(handlerInput) { // async重要
    console.log("LaunchHandler: isHandling ");
    
    let pollyVoice = await generatePollyUrl("<speak>むかーしむかし、あるところに、おじいさんとおばあさんが住んでいました。毎日、おじいさんは山に芝刈りに、おばあさんは川に洗濯にいっていました。</speak>", "Mizuki", background_sfx);
    let easySpeakOutput = '日本昔ばなしスキルです。今日のお話は、「桃太郎」。'+ pollyVoice + 'おしまい';
    
    return handlerInput.responseBuilder
      .speak(easySpeakOutput)
      .getResponse();
  
  },
};
const ExitHandler = {
    canHandle(handlerInput) {
      const request = handlerInput.requestEnvelope.request;
      return request.type === 'IntentRequest'
        && (request.intent.name === 'AMAZON.CancelIntent'
          || request.intent.name === 'AMAZON.StopIntent' || request.intent.name === 'AMAZON.PauseIntent' || request.intent.name === 'AMAZON.NoIntent');
    },
    handle(handlerInput) {
      return handlerInput.responseBuilder
        .speak("さようなら")
        .getResponse();
    },
};
const HelpHandler = {
    canHandle(handlerInput) {
      const request = handlerInput.requestEnvelope.request;
      return request.type === 'IntentRequest'
        && request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
      return handlerInput.responseBuilder
        .speak(requestAttributes.t('HELP_MESSAGE'))
        .reprompt(requestAttributes.t('HELP_REPROMPT'))
        .getResponse();
    },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);
    console.log(`Error stack: ${error.stack}`);
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return handlerInput.responseBuilder
      .speak(requestAttributes.t('ERROR_MESSAGE'))
      .getResponse();
  },
};

exports.handler = function (event, context) {
    let PoCSkill = Alexa.SkillBuilders.standard()
    .addRequestHandlers(
        LaunchHandler,
        HelpHandler,
        ExitHandler,
        SessionEndedRequestHandler,
    )
    .addErrorHandlers(ErrorHandler);

  let skill = PoCSkill.create();
  return skill.invoke(event, context);
  }
