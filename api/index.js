const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
process.env.FFMPEG_PATH = ffmpegPath;
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const ytdl = require('ytdl-core');
const ytsr = require('ytsr'); // Thêm tìm kiếm YouTube
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queue = new Map(); // Hàng đợi nhạc theo server

client.once('ready', () => {
  console.log('Bot nhạc nâng cấp đã sẵn sàng!');
  client.user.setActivity('!play để nghe nhạc', { type: 'LISTENING' });
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  // Kiểm tra voice channel
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel && ['play', 'skip', 'stop', 'pause', 'resume'].includes(command)) {
    return message.reply('Bạn cần vào một kênh voice trước!');
  }

  // Lệnh !play
  if (command === 'play' || command === 'p') {
    if (!args.length) return message.reply('Cung cấp link YouTube hoặc từ khóa để tìm kiếm!');

    let songUrl = args.join(' ');
    let songInfo;

    // Nếu không phải URL, tìm kiếm trên YouTube
    if (!ytdl.validateURL(songUrl)) {
      const searchResults = await ytsr(songUrl, { limit: 1 });
      if (!searchResults.items.length) return message.reply('Không tìm thấy bài hát!');
      songUrl = searchResults.items[0].url;
    }

    try {
      songInfo = await ytdl.getInfo(songUrl);
    } catch (err) {
      return message.reply('Link không hợp lệ hoặc có lỗi!');
    }

    const song = {
      title: songInfo.videoDetails.title,
      url: songUrl,
      duration: new Date(songInfo.videoDetails.lengthSeconds * 1000).toISOString().substr(11, 8),
      requester: message.author.tag,
    };

    if (!serverQueue) {
      const queueConstruct = {
        textChannel: message.channel,
        voiceChannel: voiceChannel,
        connection: null,
        songs: [],
        playing: true,
        volume: 1,
      };

      queue.set(message.guild.id, queueConstruct);
      queueConstruct.songs.push(song);

      try {
        const connection = await voiceChannel.join();
        queueConstruct.connection = connection;
        play(message.guild, queueConstruct.songs[0]);
      } catch (err) {
        queue.delete(message.guild.id);
        return message.reply('Có lỗi khi kết nối voice!');
      }
    } else {
      serverQueue.songs.push(song);
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Đã thêm vào hàng đợi')
        .setDescription(`[${song.title}](${song.url})`)
        .addFields({ name: 'Thời lượng', value: song.duration, inline: true })
        .setFooter({ text: `Yêu cầu bởi: ${song.requester}` });
      return message.channel.send({ embeds: [embed] });
    }
  }

  // Lệnh !queue
  if (command === 'queue' || command === 'q') {
    if (!serverQueue || !serverQueue.songs.length) return message.reply('Hàng đợi trống!');
    const embed = new EmbedBuilder()
      .setColor('#FFFF00')
      .setTitle('Hàng đợi nhạc')
      .setDescription(
        serverQueue.songs
          .map((song, i) => `${i === 0 ? 'Đang phát: ' : `${i}. `}[${song.title}](${song.url}) - ${song.duration}`)
          .join('\n')
      )
      .setFooter({ text: `Tổng: ${serverQueue.songs.length} bài` });
    return message.channel.send({ embeds: [embed] });
  }

  // Lệnh !skip
  if (command === 'skip') {
    if (!serverQueue) return message.reply('Chưa có nhạc để skip!');
    serverQueue.connection.dispatcher.end();
    message.reply('Đã skip bài hát!');
  }

  // Lệnh !stop
  if (command === 'stop') {
    if (!serverQueue) return message.reply('Chưa có nhạc để dừng!');
    serverQueue.songs = [];
    serverQueue.connection.disconnect();
    queue.delete(message.guild.id);
    message.reply('Đã dừng nhạc và rời voice!');
  }

  // Lệnh !pause
  if (command === 'pause') {
    if (!serverQueue || !serverQueue.playing) return message.reply('Chưa có nhạc đang phát!');
    serverQueue.playing = false;
    serverQueue.connection.dispatcher.pause();
    message.reply('Đã tạm dừng nhạc!');
  }

  // Lệnh !resume
  if (command === 'resume') {
    if (!serverQueue || serverQueue.playing) return message.reply('Nhạc đang phát rồi hoặc không có gì để tiếp tục!');
    serverQueue.playing = true;
    serverQueue.connection.dispatcher.resume();
    message.reply('Đã tiếp tục phát nhạc!');
  }
});

function play(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    serverQueue.connection.disconnect();
    queue.delete(guild.id);
    return;
  }

  const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
  const dispatcher = serverQueue.connection
    .play(stream, { seek: 0, volume: serverQueue.volume })
    .on('finish', () => {
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    })
    .on('error', error => {
      console.error(error);
      serverQueue.textChannel.send('Có lỗi khi phát nhạc!');
    });

  const embed = new EmbedBuilder()
    .setColor('#00FFFF')
    .setTitle('Đang phát')
    .setDescription(`[${song.title}](${song.url})`)
    .addFields({ name: 'Thời lượng', value: song.duration, inline: true })
    .setFooter({ text: `Yêu cầu bởi: ${song.requester}` });
  serverQueue.textChannel.send({ embeds: [embed] });
}

client.login(process.env.TOKEN);
