'use strict'

let conf = require('./config.json')
let jsonfile = require('jsonfile')
let got = require('got')
let Discord = require('discord.js')
let bot = new Discord.Client()
bot.login(conf.discord.key)

let channelMap = new Map(conf.channels_to_parse)

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

        let diff = []
        if (oldData && oldData.items) {
          diff = channelData.body.items.filter(function (item) {
            for (let i = 0; i < oldData.items.length; i++) {
              if (oldData.items[i].contentDetails.upload.videoId === item.contentDetails.upload.videoId) return false
            }
            return true
          })
        }

        // Update our data set
        jsonfile.writeFile(conf.youtube.datafile, channelData.body, {}, function (err) {
          if (err) console.error(err)
        })

        if (diff.length) resolve(diff)
        if (diff.length === 0) reject('No new videos.') // eslint-disable-line
      })
      .catch(err => { reject(new Error(err)); throw new Error(err) })
  })
}

/**
 * Outputs data to the Discord channel supplied in config.
 * @param {Array<Object>} videoData Diff video data supplied via parseChannelInfo
 */
function outputYoutubeDataToDiscordChannel (videoData) {
  let say = `**New videos have been uploaded by Tirean! Wowsers!**\n`
  videoData.forEach(function (videoInfo) {
    // let date = new Date(videoInfo.snippet.publishedAt)
    // let thumbUrl = videoInfo.snippet.thumbnails.medium.url
    // let channelTitle = videoInfo.snippet.channelTitle
    let title = videoInfo.snippet.title
    let vid = videoInfo.contentDetails.upload.videoId

    say += `"${title}" -- https://www.youtube.com/watch?v=${vid}\n`
  })

  // Get the channel object
  let channel = bot.channels.get(conf.discord.announceChannel)
  if (channel) {
    channel.send(say)
  }
}

function parseTwitchInfo () {
  let twitchUrl = `https://api.twitch.tv/kraken/streams?stream_type=live&limit=100&channel=${conf.twitch.channels.join(',')}`
  return new Promise(function (resolve, reject) {
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
          if (err) console.error(err)
        })

        if (wasOnNowOff.length && wasOffNowOn.length) {
          resolve({
            'wasOnNowOff': wasOnNowOff,
            'wasOffNowOn': wasOffNowOn
          })
        } else {
          reject('No changes to Twitch.') // eslint-disable-line
        }
      })
      .catch(function (err) {
        console.warn(err)
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

      say += `${name} just went live playing ${game}! Go check it out at https://twitch.tv/${username}`
    })

    // Get the channel object
    let channel = bot.channels.get(conf.discord.announceChannel)
    if (channel) {
      channel.send(say)
    }
  }
}

bot.on('ready', function () {
  console.info('Discord bot ready')
  setInterval(function () {
    parseChannelInfo(channelMap.get('TireanTV'))
      .then(outputYoutubeDataToDiscordChannel)
      .catch(function (err) {
        console.warn(err)
      })

    parseTwitchInfo()
      .then(outputTwitchDataToDiscordChannel)
      .catch(function (err) {
        console.warn(err)
      })
  }, conf.youtube.parseWaitTime)
})
