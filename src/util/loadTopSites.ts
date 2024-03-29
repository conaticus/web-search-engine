import fs from "fs";
import readline from "readline";
import Crawler from "../crawler";
import TaskThrottler from "./TaskThrottler";

const SITE_LIMIT = 20_000;

export default async function loadTopSites() {
    const fileStream = fs.createReadStream("top-1m.txt");
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    const taskThrottler = new TaskThrottler(50, 500);
    const tasks = [];
    let lineNumber = 1;

    for await (const line of rl) {
        lineNumber++;
        if (lineNumber <= 10_000) continue;

        if (lineNumber == SITE_LIMIT) break;

        const url = "https://" + line;

        const task = (async () => {
            lineNumber++;

            return new Promise(async (resolve) => {
                try {
                    await taskThrottler.throttle();
                    taskThrottler.aquire();

                    const crawler = await Crawler.create(url, lineNumber);
                    if (!crawler) return new Promise((resolve) => resolve(undefined));
                    await crawler.crawl(url);

                    taskThrottler.release();
                    resolve(undefined);
                } catch {
                    taskThrottler.release();
                    console.log(`Failed to crawl for unknown reason: ${url}`);
                    resolve(undefined);
                }
            });
        })();

        tasks.push(task);
    }

    await Promise.all(tasks);
}
