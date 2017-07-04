'use strict'

let conf = require('./config.json')
let jsonfile = require('jsonfile')
let got = require('got')
let Discord = require('discord.js')
let bot = new Discord.Client()
let humanize = require('humanize')
bot.login(conf.discord.key)

let info = function (...args) { console.info(`${humanize.date('Y/m/d H:i:s')} ${args}`) }
let warn = function (...args) { console.warn(`${humanize.date('Y/m/d H:i:s')} ${args}`) }
let error = function (...args) { console.error(`${humanize.date('Y/m/d H:i:s')} ${args}`) }

let channelMap = new Map(conf.youtube.channels_to_parse)

function getFreshConfig () {
  return jsonfile.readFileSync('./config.json', {throws: false})
}

function pollYoutube () {
  channelMap.forEach(function (channelId, key) {
    parseChannelInfo(channelMap.get(channelId))
      .then(outputYoutubeDataToDiscordChannel)
      .catch(function (err) {
        warn(err)
      })
  })
}

/**
 * Gets and parses YouTube channel info, resolves if there is a new video with the array, rejects with string if not.
 * @param {String} channelId Mapped channel info
 * @return {Promise}
 */
function parseChannelInfo (channelId) {
  let youtubeUrl = `https://www.googleapis.com/youtube/v3/activities?maxResults=25` +
                  `&channelId={channelId}` +
                  `&part=snippet%2CcontentDetails` +
                  `&key=${conf.youtube.key}`
  return new Promise(function (resolve, reject) {
    got(youtubeUrl.replace(/{channelId}/g, channelId), {json: true})
      .then(function (channelData) {
        let oldData = jsonfile.readFileSync(conf.youtube.datafile, {throws: false})
        if (!oldData || !oldData.items) oldData = {items: []}
        let channelTitle = channelData.body.items.length ? channelData.body.items[0].snippet.channelTitle : ''

        let diff = []
        diff = channelData.body.items.filter(function (item) {
          for (let i = 0; i < oldData.items.length; i++) {
            if ((oldData.items[i].contentDetails.upload.videoId === item.contentDetails.upload.videoId) && item.snippet.type === 'upload') return false
          }
          return true
        })

        // Update our data set
        jsonfile.writeFile(conf.youtube.datafile, channelData.body, {}, function (err) {
          if (err) error(err)
        })

        if (diff.length) resolve(diff)
        if (diff.length === 0) reject(`No new videos for ${channelTitle}`) // eslint-disable-line
      })
      .catch(err => { reject(new Error(err)); throw new Error(err) })
  })
}

/**
 * Outputs data to the Discord channel supplied in config.
 * @param {Array<Object>} videoData Diff video data supplied via parseChannelInfo
 */
function outputYoutubeDataToDiscordChannel (videoData) {
  let say = `**New videos have been uploaded by {channel}! Wowsers!**\n`
  let channelTitle = ''
  videoData.forEach(function (videoInfo) {
    // let date = new Date(videoInfo.snippet.publishedAt)
    // let thumbUrl = videoInfo.snippet.thumbnails.medium.url
    channelTitle = videoInfo.snippet.channelTitle
    let title = videoInfo.snippet.title
    let vid = videoInfo.contentDetails.upload.videoId

    say += `"${title}" -- https://www.youtube.com/watch?v=${vid}\n`
  })
  say = say.replace(/{channel}/gi, channelTitle)

  // Get the channel object
  let channel = bot.channels.get(conf.discord.announceChannel)
  if (channel) {
    channel.send(say)
  }
}

function parseTwitchInfo () {
  let freshConfig = jsonfile.readFileSync('./config.json')
  let twitchUrl = `https://api.twitch.tv/kraken/streams?stream_type=live&limit=100&channel=${Object.values(freshConfig.twitch.channels).join(',')}`
  return new Promise(function (resolve, reject) {
    if (freshConfig.twitch.channels.length === 0) {
      reject(new Error('No Twitch channels configured.'))
      return
    }

    let opts = {
      'headers': {
        'Accept': 'application/vnd.twitchtv.v3+json',
        'Client-ID': conf.twitch.clientid
      },
      'json': true
    }
    got(twitchUrl, opts)
      .then(function (channelsInfo) {
        let oldData = jsonfile.readFileSync(conf.twitch.datafile, {throws: false})

        let wasOnNowOff = []
        let wasOffNowOn = []
        if (!oldData || !oldData.streams) oldData = {streams: []}

        wasOnNowOff = oldData.streams.filter(function (stream) {
          // Check if still live, if element exists in the old set, return false.
          for (let s = 0; s < channelsInfo.body.streams.length; s++) {
            let online = channelsInfo.body.streams[s]
            if (stream._id === online._id) return false // still online
          }
          return true
        })

        wasOffNowOn = channelsInfo.body.streams.filter(function (stream) {
          // Check if is now online, was previously offline.
          for (let s = 0; s < oldData.streams.length; s++) {
            let old = oldData.streams[s]
            if (stream._id === old._id) return false // still online
          }
          return true
        })

        // Update our data set
        jsonfile.writeFile(conf.twitch.datafile, channelsInfo.body, {}, function (err) {
          if (err) error(err)
        })

        if (wasOnNowOff.length || wasOffNowOn.length) {
          if (wasOffNowOn.length) {
            let usernames = []
            wasOffNowOn.forEach(function (stream) {
              usernames.push(stream.channel.display_name)
            })
            info(`${usernames.length} channels have started streaming: ${usernames.join(', ')}`)
          }
          if (wasOnNowOff.length) {
            let usernames = []
            wasOnNowOff.forEach(function (stream) {
              usernames.push(stream.channel.display_name)
            })
            info(`${usernames.length} channels have stopped streaming: ${usernames.join(', ')}`)
          }
          resolve({
            'wasOnNowOff': wasOnNowOff,
            'wasOffNowOn': wasOffNowOn
          })
        } else {
          reject(`No changes to Twitch channels: ${Object.values(freshConfig.twitch.channels).join(', ')}`) // eslint-disable-line
        }
      })
      .catch(function (err) {
        warn(err)
      })
  })
}

function outputTwitchDataToDiscordChannel (data) {
  let say = ''

  if (data.wasOffNowOn.length) {
    data.wasOffNowOn.forEach(function (channel) {
      let username = channel.channel.name
      let name = channel.channel.display_name
      let game = channel.game

      let twitch = getFreshConfig().twitch.channels
      let userId = null
      for (var prop in twitch) {
        if (twitch.hasOwnProperty(prop)) {
          if (twitch[prop] === username) {
            userId = prop
          }
        }
      }
      if (userId) name = `${name} (<@${userId}>)`

      say += `${name} just went live playing ${game}! Go check it out at https://twitch.tv/${username}\n`
    })

    // Get the channel object
    let channel = bot.channels.get(conf.discord.announceChannel)
    if (channel) {
      channel.send(say)
    }
  }
}

bot.on('ready', function () {
  info('Discord bot ready')
  setInterval(function () {
    info('Polling YouTube ..')
    // pollYoutube()

    info('Polling Twitch ..')
    parseTwitchInfo()
      .then(outputTwitchDataToDiscordChannel)
      .catch(function (err) {
        warn(err)
      })
  }, conf.parseWaitTime)
})

bot.on('message', function (message) {
  if (message.author.id === bot.user.id) return

  // only if someone has mentioned the bot
  if (message.mentions.members.has(bot.user.id)) {
    let config = jsonfile.readFileSync('./config.json', { throw: false })
    if (config) {
      let current = config.twitch.channels
      let userId = message.author.id
      let say = `${message.author}, `

      let rmentions = /<@[0-9]+?>/g
      let content = message.content.replace(rmentions, '').trim()
      let contentSplit = content.split(' ')
      let channel = contentSplit.length >= 1 ? contentSplit[0].toLowerCase() : null

      // early-fail
      if (!channel) return

      if (current[userId]) {
        // Update channel
        say += `updated your Twitch username to ${channel}! :PogChamp:`
      } else {
        // Insert new
        say += `added your Twitch username as ${channel}! :PogChamp:`
      }
      current[userId] = channel
      config.twitch.channels = current

      jsonfile.writeFile('./config.json', config, {spaces: 2}, function (err) {
        if (err) {
          say = 'Error updating Twitch username. Tell mega. :OpieOP:'
        }
        message.channel.send(say)
      })
    }
  }
})
