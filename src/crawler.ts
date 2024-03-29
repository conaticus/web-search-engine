import puppeteer, { Browser, Page } from "puppeteer";
import QueryBuilder from "./db/QueryBuilder";
import { v4 as uuidv4 } from "uuid";
import isRootForbidden from "./util/RobotsParser";
import loadLemmatizedWord from "./util/lemmatizedMap";

export default class Crawler {
    browser: Browser;
    page: Page;
    rank: number;

    public static async create(url: string, rank: number): Promise<Crawler | null> {
        const crawler = new Crawler();

        crawler.rank = rank;

        try {
            crawler.browser = await puppeteer.connect({
                browserWSEndpoint: `wss://${process.env.USER}:${process.env.PASSWORD}@brd.superproxy.io:9222`,
            });
        } catch (e) {
            console.log(`Failed to create browser for: ${url}`);
            return null;
        }

        crawler.page = await crawler.newPage();
        return crawler;
    }

    public async newPage(): Promise<Page> {
        const page = await this.browser.newPage();
        await page.setRequestInterception(true);

        page.on("request", (request) => {
            if (request.isInterceptResolutionHandled()) return;

            switch (request.resourceType()) {
                case "image":
                case "media":
                case "stylesheet":
                case "font":
                case "script":
                    request.abort();
                    break;
                default:
                    request.continue();
            }
        });

        return page;
    }

    /**
     * Checks the robots.txt for a URL to see if the scraper is permitted to crawl the website's root
     */
    async isPermitted(url: string): Promise<boolean> {
        const robotsUrl = url + "/robots.txt";

        try {
            await this.page.goto(robotsUrl);
        } catch {
            return true;
        }

        const robotsContents = await this.page.content();
        return !isRootForbidden(robotsContents);
    }

    async crawl(url: string) {
        console.log(`Obtaining Permission: ${url}`);

        const isPermitted = await this.isPermitted(url);
        if (!isPermitted) return;

        console.log(`Crawling: ${url}`);

        try {
            await this.page.goto(url);
        } catch (e) {
            console.log(`[WARNING]: Failed to request: ${url} (likely not permitted)`);
            return;
        }

        const language = await this.page.evaluate(() => {
            const html = document.querySelector("html");
            return html?.getAttribute("lang");
        });

        // Only index english websites
        if (language != "en" && language != "en-gb") return;

        const [pageTitle, pageDescription] = await this.page.evaluate(() => {
            const metaTags = document.getElementsByTagName("meta");
            let description = "";

            for (var i = 0; i < metaTags.length; i++) {
                if (metaTags[i].getAttribute("name") === "description") {
                    description = metaTags[i].getAttribute("content") as string;
                }
            }

            return [document.title ? document.title : "", description];
        });

        // TODO: Insert more data such as attributes etc.
        let words: string[] = await this.page.evaluate(() => {
            const documentText = (document.querySelector("*") as any).innerText;

            return documentText
                .toLowerCase()
                .replace(/[.,\/#!$%\^&\*;:{}=\-_`'~()]/g, "")
                .split(/[\n\r\s]+/g);
        });

        const tasks = words.map((word) => loadLemmatizedWord(word));
        words = await Promise.all(tasks);

        if (words.length == 0) {
            console.log(`[WARNING]: No words found for: ${url}`);
            return;
        }

        await this.page.close();

        const wordIndicies: Record<string, number> = {};
        const keywordIds: Record<string, string> = {};
        const wordPositions: number[] = [];
        const wordIds: string[] = [];

        let wordPos = 0;
        let keywordIdsLength = 0;

        words.forEach((word) => {
            if (wordIndicies[word]) wordIndicies[word]++;
            else wordIndicies[word] = 1;

            if (!keywordIds[word]) {
                keywordIds[word] = uuidv4();
                keywordIdsLength++;
            }

            wordIds.push(keywordIds[word]);
            wordPositions.push(++wordPos);
        });

        const websiteId = uuidv4();
        // Not really neccesary and quite unoptimised, but is fine for now. TODO: Fix this
        const websiteIdsBatch = words.map(() => websiteId);
        const ranksBatch = words.map(() => String(this.rank));

        const wordIndiciesBatch = words.map((word) => wordIndicies[word]);

        try {
            await QueryBuilder.insert(
                "websites",
                ["id", "title", "description", "url", "word_count", "rank"],
                [websiteId, pageTitle, pageDescription, url, words.length, this.rank]
            );

            const { rows: keywordRows } = await QueryBuilder.insertManyOrUpdate(
                "keywords",
                ["id", "word", "documents_containing_word"],
                [
                    Object.values(keywordIds),
                    Object.keys(keywordIds),
                    new Array<number>(keywordIdsLength).fill(1), // Ew
                ],
                ["UUID", "VARCHAR(45)", "BIGINT"],
                ["word"],
                "documents_containing_word = keywords.documents_containing_word + 1",
                ["word", "id"]
            );

            const updatedWordIdsMap: Record<string, string> = {};

            keywordRows.forEach(({ word, id }) => {
                updatedWordIdsMap[word] = id;
            });

            const updatedWordIds: string[] = [];

            words.forEach((word) => {
                updatedWordIds.push(updatedWordIdsMap[word]);
            });

            await QueryBuilder.insertMany(
                "website_keywords",
                ["keyword_id", "website_id", "occurrences", "position"],
                [updatedWordIds, websiteIdsBatch, wordIndiciesBatch, wordPositions],
                ["UUID", "UUID", "INT", "INT"]
            );

            console.log(`Succesfully crawled: ${url}`);
        } catch (e) {
            console.log(`[WARNING]: Failed to index: ${url}\n\n${e}`);
        }
    }
}
