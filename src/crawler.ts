import puppeteer, { Browser, Page } from "puppeteer";
import QueryBuilder from "./db/QueryBuilder";
import { v4 as uuidv4 } from "uuid";

export default class Crawler {
    browser: Browser;
    documentCount: number;

    public static async create(documentCount: number): Promise<Crawler> {
        const crawler = new Crawler();
        crawler.documentCount = documentCount;
        crawler.browser = await puppeteer.connect({
            browserWSEndpoint: `wss://${process.env.USER}:${process.env.PASSWORD}@brd.superproxy.io:9222`,
        });

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

    public async crawl(url: string) {
        const page = await this.newPage();

        try {
            await page.goto(url);
            console.log(`Crawling: ${url}`);
        } catch (e) {
            console.log(`[WARNING]: Failed to request: ${url}\n\n${e}`);
        }

        // TODO: Insert more data such as attributes etc.
        const words: string[] = await page.evaluate(() => {
            const documentText = (document.querySelector("*") as any).innerText;

            return documentText
                .toLowerCase()
                .replace(/[.,\/#!$%\^&\*;:{}=\-_`'~()]/g, "")
                .split(/[\n\r\s]+/g);
        });

        await page.close();

        const wordIndicies: Record<string, number> = {};
        const keywordIds: Record<string, string> = {};
        const wordPositions: number[] = [];
        const wordIds: string[] = [];

        let wordPos = 0;
        let keywordIdsLength = 0;

        words.forEach((word) => {
            if (wordIndicies[word]) wordIndicies[word]++;
            else wordIndicies[word] = 1;
            if (url.includes("asus") && word == "the") console.log("yeet");

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

        const wordIndiciesBatch = words.map((word) => wordIndicies[word]);

        try {
            await QueryBuilder.insert("websites", ["id", "url"], [websiteId, url]);

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
        } catch (e) {
            console.log(`[WARNING]: Failed to index: ${url}\n\n${e}`);
        }
    }
}
