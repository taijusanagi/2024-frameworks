import type { NextApiRequest, NextApiResponse } from "next";
import { kv } from "@vercel/kv";

import ffmpeg from "fluent-ffmpeg";

const fs = require("fs");
const util = require("util");
const os = require("os");
const path = require("path");
const stream = require("stream");
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);
// const writeFileAsync = util.promisify(fs.writeFile);
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;

import { Livepeer } from "livepeer";
const livepeer = new Livepeer({ apiKey: process.env.LIVEPEER_API_KEY });

import { NFTStorage, File, Blob } from "nft.storage";
const client = new NFTStorage({ token: process.env.NFT_STORAGE_TOKEN || "" });

const duration = 2;
const images = ["https://placehold.jp/500x500.png", "https://placehold.jp/500x500.png"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = await req.body;
  const sessionKey = body.sessionKey;
  //   const sessionData: any = await kv.get(sessionKey);
  const tempDir = os.tmpdir();
  const localImages: string[] = [];
  const time = Date.now();
  for (let i = 0; i < images.length; i++) {
    const fileName = `${time}-${i}.png`;
    const tempFilePath = path.join(tempDir, fileName);
    console.log(images[i]);
    const response = await fetch(images[i] as string);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFileAsync(tempFilePath, buffer);
    console.log(tempFilePath);
    localImages.push(tempFilePath);
  }
  const allChunks: Buffer[] = [];
  const bufferStream = new stream.PassThrough();
  bufferStream.on("data", (chunk: Buffer) => {
    allChunks.push(chunk);
  });
  ffmpeg.setFfmpegPath(ffmpegPath);
  const command = ffmpeg();
  localImages.forEach((image: string) => {
    command.input(image).inputOptions(["-loop 1", `-t ${duration}`]);
  });
  const outputPath = path.join(tempDir, `${time}-video.mp4`);
  await new Promise((resolve, reject) => {
    command
      .fps(1)
      .on("start", function (commandLine: any) {
        console.log(`Spawned FFmpeg with command: ${commandLine}`);
      })
      .on("error", function (err: any) {
        console.log(`An error occurred: ${err.message}`);
      })
      .on("end", async function () {
        console.log("Video has been created");
        const buffer = await readFileAsync(outputPath);
        const file = new File([buffer], "video.mp4", { type: "video/mp4" });
        const cid = await client.storeDirectory([file]);
        console.log(cid);
        const res = await livepeer.asset
          .createViaURL({ name: "video", url: `ipfs://${cid}/video.mp4` })
          .catch((error) => {
            console.error("Error requesting asset upload:", error);
          });
        fs.unlink(outputPath, (err: Error) => {
          if (err) console.error("Error removing temporary file:", err);
        });
        for (let i = 0; i < localImages.length; i++) {
          fs.unlink(localImages[i], (err: Error) => {
            if (err) console.error("Error removing temporary file:", err);
          });
        }
        resolve(null);
      })
      .save(outputPath);
  });
  res.status(200).json({ status: "success" });
}
