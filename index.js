const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(8000, () => {
  console.log('Server started');
});

// ✅ دعم لاعبين البيدروك (Floodgate)
const bedrockPrefix = config.server['bedrock-prefix'] || '.'; // ممكن تغيرها من settings.json

const bot = mineflayer.createBot({
  username: config.server['bedrock-enabled']
    ? `${bedrockPrefix}${config['bot-account']['username']}`
    : config['bot-account']['username'],
  password: config['bot-account']['password'],
  auth: config['bot-account']['type'],
  host: config.server.ip,
  port: config.server.port,
  version: config.server.version,
});



  bot.loadPlugin(pathfinder);
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.settings.colorsEnabled = false;

  // ✅ متغيرات النوم التلقائي (مكانها الصحيح)
  let autoSleepEnabled = false;
  let hasSleptThisNight = false;

  let pendingPromise = Promise.resolve();

  // ===== نظام التسجيل والدخول =====
  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register command.`);

      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);

        if (message.includes('successfully registered')) {
          console.log('[INFO] Registration confirmed.');
          resolve();
        } else if (message.includes('already registered')) {
          console.log('[INFO] Bot was already registered.');
          resolve();
        } else if (message.includes('Invalid command')) {
          reject(`Registration failed: Invalid command. Message: "${message}"`);
        } else {
          reject(`Registration failed: unexpected message "${message}".`);
        }
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login command.`);

      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);

        if (message.includes('successfully logged in')) {
          console.log('[INFO] Login successful.');
          resolve();
        } else if (message.includes('Invalid password')) {
          reject(`Login failed: Invalid password. Message: "${message}"`);
        } else if (message.includes('not registered')) {
          reject(`Login failed: Not registered. Message: "${message}"`);
        } else {
          reject(`Login failed: unexpected message "${message}".`);
        }
      });
    });
  }

  bot.once('spawn', () => {
    console.log('\x1b[33m[AfkBot] Bot joined the server', '\x1b[0m');

    if (config.utils['auto-auth'].enabled) {
      console.log('[INFO] Started auto-auth module');
      const password = config.utils['auto-auth'].password;

      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => console.error('[ERROR]', error));
    }

    if (config.utils['chat-messages'].enabled) {
      console.log('[INFO] Started chat-messages module');
      const messages = config.utils['chat-messages']['messages'];

      if (config.utils['chat-messages'].repeat) {
        const delay = config.utils['chat-messages']['repeat-delay'];
        let i = 0;

        setInterval(() => {
          bot.chat(`${messages[i]}`);
          i = (i + 1) % messages.length;
        }, delay * 1000);
      } else {
        messages.forEach((msg) => bot.chat(msg));
      }
    }

    const pos = config.position;

    if (config.position.enabled) {
      console.log(
        `\x1b[32m[Afk Bot] Moving to (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`
      );
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk'].enabled) {
      bot.setControlState('jump', true);
      if (config.utils['anti-afk'].sneak) {
        bot.setControlState('sneak', true);
      }
    }

    // ✅ تخزين طلبات TPA والتبريد
    const tpaRequests = {};
    const cooldowns = {};

    // ===============================
    // ✅ أوامر الشات
    // ===============================
   bot.on('message', (jsonMsg) => {
  try {
    const text = jsonMsg.toString();
    const match = text.match(/^<(.+?)>\s(.+)/);
    if (!match) return;

    const username = match[1];
    const message = match[2];
    if (username === bot.username) return;

    const args = message.trim().split(' ');
    const now = Date.now();
    const cooldown = cooldowns[username];

      // ===== أمر TPA =====
      if (args[0].toLowerCase() === '!tpa' && args[1]) {
        const target = args[1];

        if (cooldown && now - cooldown < 300000) {
          const remaining = Math.ceil((300000 - (now - cooldown)) / 60000);
          return bot.chat(`/tell ${username} ⌛ انتظر ${remaining} دقيقة`);
        }

        tpaRequests[target] = { from: username, time: now };
        cooldowns[username] = now;

        bot.chat(`/tell ${username} 📨 تم ارسال طلبك إلى ${target}`);
        bot.chat(`/tell ${target} 📨 ${username} يريد الانتقال إليك!`);
        bot.chat(`/tell ${target} اكتب: !ac للقبول`);
        bot.chat(`/tell ${target} أو: !dn للرفض`);

        setTimeout(() => {
          if (tpaRequests[target] && tpaRequests[target].from === username) {
            bot.chat(`/tell ${target} ❌ لم ترد على الطلب`);
            bot.chat(`/tell ${username} ❌ تم رفض طلبك تلقائيًا`);
            delete tpaRequests[target];
          }
        }, 120000); // دقيقتين
        return;
      }

      // ===== قبول =====
      if (args[0].toLowerCase() === '!ac') {
        const request = tpaRequests[username];
        if (!request)
          return bot.chat(`/tell ${username} ❌ لا يوجد أي طلب TPA.`);

        const from = request.from;
        bot.chat(`/tell ${from} ✅ تم قبول طلبك`);
        bot.chat(`/tp ${from} ${username}`);
        delete tpaRequests[username];
        return;
      }

      // ===== رفض =====
      if (args[0].toLowerCase() === '!dn') {
        const request = tpaRequests[username];
        if (!request)
          return bot.chat(`/tell ${username} ❌ لا يوجد أي طلب TPA.`);

        const from = request.from;
        bot.chat(`/tell ${from} ❌ تم رفض طلبك.`);
        delete tpaRequests[username];
        return;
      }

      // ===== أوامر النوم التلقائي =====
      if (message.toLowerCase() === '!sleepon') {
        autoSleepEnabled = true;
        bot.chat(`💤 تم تفعيل النوم التلقائي! البوت سينام تلقائي عندما يأتي الليل.`);
        return;
      }

      if (message.toLowerCase() === '!sleepoff') {
        autoSleepEnabled = false;
        bot.chat(`🌅 تم إيقاف النوم التلقائي.`);
        return;
      }

      // ===== باقي أوامرك =====
      if (args[0].toLowerCase() === '!s') {
        const x = 381, y = 63, z = 446;
        bot.chat(`/tell ${username} 🚀 تم نقلك الآن إلى X:${x} Y:${y} Z:${z}`);
        bot.chat(`/tp ${username} ${x} ${y} ${z}`);
        return;
      }

      if (args[0].toLowerCase() === '!س') {
        const x = 381, y = 63, z = 446;
        bot.chat(`/tell ${username} 🚀 تم نقلك الآن إلى X:${x} Y:${y} Z:${z}`);
        bot.chat(`/tp ${username} ${x} ${y} ${z}`);
        return;
      }

    if (args[0].toLowerCase() === '!n') {
      const x = 346, y = 32, z = 2489;
      bot.chat(`/tell ${username} 🚀 ز:${z} و:${y} س:${x} :Z X ىلا نلآ كـلقت نم`);
      bot.chat(`/tp ${username} ${x} ${y} ${z}`);
      return;
    }

     if (args[0].toLowerCase() === '!ى') {
      const x = 346, y = 32, z = 2489;
      bot.chat(`/tell ${username} 🚀 ز:${z} و:${y} س:${x} :Z X ىلا نلآ كـلقت نم`);
      bot.chat(`/tp ${username} ${x} ${y} ${z}`);
      return;
    }

      
         if (args[0].toLowerCase() === '!nv') {
      bot.chat(`/tell ${username} تم اعطائك النايت فجن`);
      bot.chat(`/effect give ${username} minecraft:night_vision infinite 100 true`);
      return;
    }

             if (args[0].toLowerCase() === '!cl') {
      bot.chat(`/tell ${username} تم ازالته`);
      bot.chat(`/effect clear ${username} minecraft:night_vision`);
      return;
    }

                 if (args[0].toLowerCase() === '!ؤم') {
      bot.chat(`/tell ${username} تم ازالته`);
      bot.chat(`/effect clear ${username} minecraft:night_vision`);
      return;
    }

             if (args[0].toLowerCase() === '!ىر') {
      bot.chat(`/tell ${username} تم اعطائك النايت فجن`);
      bot.chat(`/effect give ${username} minecraft:night_vision infinite 100 true`);
      return;
    }

      if (args[0].toLowerCase() === '!we') {
        bot.chat(`🌅 تم تنظيف الجو`);
        bot.chat(`/weather clear`);
        return;
      }

      if (message.toLowerCase().includes('sp?')) bot.chat(`Hi ${username}`);
      if (message === '!help') bot.chat(`Commands: !tpa <@> , !we`);
      if (message === '!time')
        bot.chat(`/tell ${username} ⌛ Time: ${Math.floor(bot.time.timeOfDay / 1000)}`);
    });

    // ===== نظام النوم التلقائي =====
    bot.on('time', () => {
      if (!autoSleepEnabled) return;

      const time = bot.time.timeOfDay;
      const isNight = bot.time.isNight;

      if ((isNight || (time > 13000 && time < 23000)) && !hasSleptThisNight) {
        hasSleptThisNight = true;
        bot.chat('/time set day');
        bot.chat('💤 نام في السرير بسبب تفعيل النوم التلقائي !');
        bot.chat('تقدر توقف هاذا الشي عن طريق ( !sleepoff )');
        console.log('[AutoSleep] الليل جاء، تم تحويل الوقت إلى صباح.');
      }

      if (!isNight && time < 13000) {
        hasSleptThisNight = false;
      }
    });
  });

  bot.on('goal_reached', () => {
    console.log(`\x1b[32m[AfkBot] Bot arrived at target ${bot.entity.position}\x1b[0m`);
  });

  bot.on('death', () => {
    console.log(`\x1b[33m[AfkBot] Bot died and respawned at ${bot.entity.position}\x1b[0m`);
  });

  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      setTimeout(() => {
        createBot();
      }, config.utils['auto-recconect-delay']);
    });
  }

  bot.on('kicked', (reason) =>
    console.log('\x1b[33m', `[AfkBot] Bot was kicked:\n${reason}`, '\x1b[0m')
  );

  bot.on('error', (err) =>
    console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m')
  );
}

createBot();
