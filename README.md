# Search Engine Crawler

This is the web crawler for my second attempt at a search engine. The purpose is to:

-   Extract keywords from provided web pages
-   Lemmatize the keywords into their raw form
-   Create an efficient index inside the database for each keyword and website, prepared for the proximity and TF-IDF calculations done at query time

## Installation
I'd highly recommend using a proxy as you are likely to get blocked if you brute force web requests without one. You must have NodeJS installed & a postgres database initialised with the following schema:
```sql
CREATE DATABASE site_index;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE websites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), title VARCHAR(512) NOT NULL, description TEXT NOT NULL,
    url VARCHAR(2048) UNIQUE NOT NULL,
    word_count INT NOT NULL,
    rank INT NOT NULL
);

CREATE TABLE keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), word VARCHAR(45) UNIQUE NOT NULL, documents_containing_word BIGINT
);

CREATE TABLE website_keywords (
    id BIGSERIAL PRIMARY KEY,
    keyword_id UUID NOT NULL REFERENCES keywords (id), website_id UUID NOT NULL REFERENCES websites(id),
    occurrences INT NOT NULL,
    position INT NOT NULL
);

CREATE INDEX idx_keywords_name ON keywords (word);
CREATE INDEX website_keyword_id ON website_keywords (keyword_id);
```

In order to run this app. Be sure to create an `.env` file based on the `.env.example` file.

- Clone the repository
- `yarn`
- `yarn dev`

This runs in conjunction with the other two repositories:
- [API](https://github.com/conaticus/search-engine-api)
- [Client Side](https://github.com/conaticus/search-engine-client)
