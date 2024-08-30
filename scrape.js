const puppeteer = require('puppeteer');
const fs = require('fs').promises; // Import the fs module to read and write files

// Function to convert Chinese numeric format to integer
function parseChineseNumber(value) {
  if (value.includes('万')) {
    return parseFloat(value.replace('万', '')) * 10000;
  }
  return parseFloat(value);
}

// Function to convert date format from "YYYY-MM-DD" to "M/DD"
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

(async () => {
  try {
    // Launch Puppeteer in non-headless mode for debugging
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // Set User-Agent to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36');

    // Set viewport size
    await page.setViewport({ width: 1280, height: 800 });

    // Load cookies from the JSON file
    const cookies = JSON.parse(await fs.readFile('cookies.json', 'utf8'));
    
    // Set cookies in Puppeteer
    await page.setCookie(...cookies);

    // Increase navigation timeout
    await page.setDefaultNavigationTimeout(60000); // Set navigation timeout to 60 seconds

    // Navigate to the target page
    await page.goto('https://creator.xiaohongshu.com/creator/notes', { waitUntil: 'networkidle2' });

    // Scroll to the bottom of the page to ensure all content is loaded
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Wait for the info list to load
    await page.waitForSelector('.info-list', { timeout: 60000 });

    // Extract metrics, titles, and publish times from the first page
    const postsData = await page.evaluate(() => {
      const posts = [];
      const infoLists = document.querySelectorAll('.info-list');

      infoLists.forEach(infoList => {
        const postData = {
          "爆款": false, // Default value for 爆款
          "阅读": "0",   // Default value for 阅读
          "点赞": "0",   // Default value for 点赞
          "收藏": "0",   // Default value for 收藏
          "评论": "0",   // Default value for 评论
          "分享": "0",   // Default value for 分享
          "笔记涨粉": "0" // Default value for 笔记涨粉
        };

        // Extract the title from the info-text class
        const titleElement = infoList.parentElement.querySelector('.info-text .title');
        if (titleElement) {
          postData['标题'] = titleElement.innerText.trim(); // Add title as 标题
        }

        // Extract the publish date
        const publishTimeElement = infoList.parentElement.querySelector('.info-text .publish-time');
        if (publishTimeElement) {
          postData['发布日期'] = publishTimeElement.innerText.replace('发布于', '').trim(); // Extract and clean publish date
        }

        const listItems = infoList.querySelectorAll('li');

        listItems.forEach(item => {
          const label = item.querySelector('label');
          const valueElement = item.querySelector('b');

          if (label && valueElement) {
            const key = label.innerText.trim(); // Use the label text as the key
            const value = valueElement.innerText.trim(); // Get the value from the <b> tag
            
            // Map keys to expected Google Sheet headers
            switch (key) {
              case '观看量':
                postData['阅读'] = value; // Assign 观看量 to 阅读
                break;
              case '点赞量':
                postData['点赞'] = value;
                break;
              case '收藏数':
                postData['收藏'] = value;
                break;
              case '评论数':
                postData['评论'] = value;
                break;
              case '分享数':
                postData['分享'] = value;
                break;
              case '直接涨粉数':
                postData['笔记涨粉'] = value;
                break;
              default:
                break;
            }
          }
        });

        // Add the postData object to the posts array
        if (Object.keys(postData).length > 0) {
          posts.push(postData);
        }
      });

      return posts;
    });

    // Convert and process the data outside of evaluate
    const processedData = postsData.map(post => {
      // Convert 阅读 to a number and check if it's a 爆款
      const parsed阅读 = parseChineseNumber(post['阅读']);
      post['阅读'] = parsed阅读;
      post['爆款'] = parsed阅读 > 10000;

      // Format 日期 to M/DD
      if (post['发布日期']) {
        post['发布日期'] = formatDate(post['发布日期']);
      }

      return post;
    });

    // Sort the posts data by publish date (发布日期)
    processedData.sort((a, b) => new Date(b['发布日期']) - new Date(a['发布日期']));

    // Convert the posts data to CSV format
    const csvData = processedData.map(post => {
      return [
        `"北美省钱快报"`, // Static value for the first column
        `"Jade"`,        // Static value for the second column
        `""`,            // Empty value for the third column
        `"${post['发布日期'] || ''}"`, // Format date to M/DD
        `"${post['标题'] || ''}"`,
        `${post['爆款'] ? 'TRUE' : 'FALSE'}`, // Use TRUE or FALSE without quotes for Google Sheets checkbox
        `"${post['阅读'] || ''}"`,
        `"${post['点赞'] || ''}"`,
        `"${post['收藏'] || ''}"`,
        `"${post['评论'] || ''}"`,
        `"${post['分享'] || ''}"`,
        `"${post['笔记涨粉'] || ''}"`
      ].join(',');
    });

    // Add a header row to the CSV data
    const csvHeader = '账号,制作人,发布类型,发布日期,标题,爆款,阅读,点赞,收藏,评论,分享,笔记涨粉';
    const csvContent = [csvHeader, ...csvData].join('\n');

    // Write the CSV data to a file
    await fs.writeFile('posts_data.csv', csvContent);

    console.log('Data successfully written to posts_data.csv');

    // Close the browser
    await browser.close();
  } catch (error) {
    console.error('Error scraping data:', error);
  }
})();
