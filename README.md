# alexa-polly-background-mixing-nodejs

Daniel Mittendorfさんによる、ask-sdk v2でPollyの音声をBGMとミックスするPoCをforkして、なるべくかんたんに試せるように、修正・解説を加えました。
fork元も必ずご覧ください。
https://github.com/DanMittendorf/alexa-polly-background-mixing-nodejs/

以下、fork元の説明より。

```
このプロジェクトは、lambda-audio: npmjs.com/package/lambda-audio を元に、AWS Lambda向けにコンパイルされたバージョンのSoX (Sound eXchange) のコマンドラインツールを使っています。

ただし、lambda-audioパッケージの2箇所で修正が必要でした。詳細は下記の#5をご覧ください。重要です！

これにより、BGMやサウンドとミックスした異なる言語のPolly音声を生成することができます。

node.js / ask-sdk v2 を使ったAlexaスキルで使用することができます。Jovoフレームワークや他のフレームワークにも同様にポートできるのではないかと思います。自由にやってください、ただし、参考のためにこのプロジェクトにリンクしてください。
```

**注意！forkして何かしら手を加える場合、本レポジトリのfolk元であるDanielさんのレポジトリURLを明記するようにしてください。**

# セットアップ （一部補足等加えています）

1. Alexa開発者コンソールでスキルを新規作成
  - models/ja-JP.jsonでモデルを作成
  - lambda関数作成後にエンドポイントを設定する

2. Lambda関数を新規作成。
  - このサンプルでは、東京リージョンを使っています。
  - ランタイムはNode.js 8.10を選択してください。**Node.js 10.Xでは動きません！ご注意ください！**
  - fork元では結構色々権限つけてますが(**スクリーションショット #1**)、AWSLambdaBasicExecutionRoleに以下を追加すれば、サンプルではOKだと思います。
    - AmazonS3FullAccess
    - AmazonPollyFullAccess
  - PollyのMP3生成とBGMとのミックスに時間がかかる場合は、Lambda関数のタイムアウトをデフォルトの3秒から15秒に。(**スクリーンショット #2**)

3. S3バケットを作成
  - https://tech-blog.s-yoshiki.com/2019/01/1052/ を参考に。S３に書き込んだファイルがパブリックアクセス可能にになるようにしておく。
  - CORS設定も忘れないこと。
```
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<CORSRule>
    <AllowedOrigin>http://ask-ifr-download.s3.amazonaws.com</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
</CORSRule>
<CORSRule>
    <AllowedOrigin>https://ask-ifr-download.s3.amazonaws.com</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
</CORSRule>
</CORSConfiguration>
```

4. BGMのMP3ファイルを lambda/custom/audioに配置. Pollyと同じ, 48kb/s 22050 hzにすること. "Lame XP"やffmpegなどを使ってください。
  - ffmpegはこんな感じ
```
$ ffmpeg -i 変換前mp3ファイル -ac 2 -codec:a libmp3lame -b:a 48k -ar 22050 -af volume=-20dB -write_xing 0 変更後mp3ファイル
```
  - ボリューム少し下げてます、Pollyの声が聞こえなくなるので。

5. nodeモジュール lambda-audioについて
  - node_modulesはこのレポジトリのものをそのまま使えばOKです。npm i叩く必要ありません。cloneしたものをそのままアップロードすればOKです。
  - /lib/lambda-audio.js の15行目、36行目で修正が入っています。これは/bin/には実行権がなく、/tmp/にバイナリを配置し、実行権を付与するためです。

6. git cloneして以下を修正
  - 14行目、S3バケット名を指定してください。
  - 18行目、BGMとなるオーディオファイルのファイル名を指定してください。（サンプルのオーディオファイルが用意されてますのでそのまま使ってもOK）
  - 156行目、generatePollyUrlのところが発話になります
    - 第1引数： PollyにわたすSSMLになります。
      - ```<speak>```と```</speak>```で囲まれた部分を変更すると発話内容が変わります。
      - ここでさらにaudioタグを使うことはできませんのでご注意ください。
    - 第2引数： Pollyの音声の種類。Takumi か Mizuki を指定。
    - 第3引数： 変更不要
  - コード内にコメントが記載されています。完璧ではないかもですが、理解はできると思います。
  - **注意！ 私のforkで動かない場合はこのレポジトリでissu立ててください。folk元に問い合わせないようにお願いします！**

7. アップロード
  - lambda/custom配下の*.js, node_modules/, audio/ をまとめてZIPファイルにしてlambdaにアップロードしてください
  - ファイルサイズが大きくなるのでS３からのアップロード推奨

8. ask-cli使うともっとかんたんにデプロイできるそうです

# 参考までにスクリーンショット

<img width="400" alt="setup #1 permissions" src="https://digivoice.io/wp-content/uploads/2019/04/setup-things.jpg"/>
<img width="400" alt="setup #2 timeout" src="https://digivoice.io/wp-content/uploads/2019/04/setup-things_2.jpg"/>

