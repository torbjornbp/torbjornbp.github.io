---
title: Migrating to hugo and implementing "clown mode"
date: '2024-07-04'
description: How I migrated my blog from jekyll to hugo and implemented "clown mode" to view the page with an alternate font.
categories: 
  - bits and pieces
tags:
  - web design
  - typography
  - iosevka
  - inter
  - atkinson hyperlegible
  - hugo
  - jekyll
  - clown mode
---

I recently made the decision to move my home page from [Jekyll](https://jekyllrb.com/ "Home page of Jekyll") to [Hugo](https://gohugo.io/ "Home page of Hugo"). 
The primary motivations behind this migration were to simplify things by only using a single static site generator type for the pages I work on. 

Having set up a Hugo page before, getting everything up and running again was not too difficult. 
Some frontmatter, formatting, and paths had to change, some URL aliases had to be added so as to not break existing links. 
After an afternoon of work and a few hours of my usual CSS and HTML blunders, I was ready to go live again.

I'm using the [PaperMod theme](https://github.com/adityatelange/hugo-PaperMod "Github repository for the PaperMod theme") for my [work blog](https://digitalpreservation-blog.nb.no/ "The blog of the Digital Preservation team at the National Library of Norway"), but it has much more functionality than I really need for my home page. 
If I'm to learn anything, I figure it's better to start with something more barebones. 
This time I opted for the fairly minimal [XMin theme](https://github.com/yihui/hugo-xmin "Github repository for the XMin theme") as a starting point. 
It only consists of around 140 lines of code and is relatively close to the kind of page I want out of the box. 
I like my web pages simple and flat, with a functional look and (relatively) high legibility. 
All in all, I'm mostly happy with the current iteration of this page, although I'll probably spend hours changing margins and padding back and forth to no avail.

## Legibility vs. character
Previously I had used [Inter](https://rsms.me/inter/ "Home page of the Inter font") for my main body of text. 
While it is both an excellent font and very legible, I also find that these neo-grotesque fonts lack a bit of character. 
I also considered using [Atkinson Hyperlegible](https://brailleinstitute.org/freefont "Atkinson Hyperlegible at the braille institutes home page"). 
While it might be even more legible than Inter, it is also slightly less pretty.
In the end though, I ended up sacrificing some legibility for character - it is a personal web site after all!

I'm currently using the [Iosevka](https://typeof.net/Iosevka/ "Home page of the Iosevka font") font family. 
Iosevka Aile for prose and Iosevka Term for code blocks (which I mostly have used for box drawings). 

## Clown mode > dark mode
While contemplating the balance between legibility and aesthetics, I toyed with the idea of allowing readers to set the font themselves. 
Instead of doing something practical and sensible with the font-changing idea though, I opted for a more whimsical idea.

I have turned the "☻"" at the top of my page into a button that toggles a font change to Comic Sans (for prose) and [Comic Shanns Mono](https://github.com/jesusmgg/comic-shanns-mono "github repository for the Comic Shanns Mono font")! 
It's done using a bit of CSS and a Hugo partial with some JavaScript.
I call it clown mode.

<div style="border: 1px solid #aaa; box-shadow: 2px 2px #ddd; padding: 5px; margin: 4px;">
<video width="100%" autoplay muted loop playsinline;
   <source src="clowndemo.mp4" type="video/mp4">
   <p>Your browser does not support the video format/codec.</p>
</video>
</div>

There's still some issues with box drawing characters in Comic Shanns Mono, but I'm sure one of the many [Comic Shanns](https://github.com/shannpersand/comic-shanns "Github repository for the Comic Shanns font") forks has a solution. 
If I was rich I could also shell out for [Comic Code](https://tosche.net/fonts/comic-code "Comic Code on the tosche.net") for a solid solution.

Why do this though? 
First of all I find the idea of a professional Comic Sans hilarious, but on the other hand it is actually a pretty legible font!
It's the best of both worlds - putting the fun in function.

The Hugo partial and css used can be found below:

### Clown.html Hugo partial

```html
<button id="font-change-button" class="font-change-button" aria-label="Toggle font style">☻</button>
<script>
(function() {
  const btn = document.getElementById('font-change-button');
  
  function setFontState(isComicSans) {
    document.body.classList.toggle('comic-sans', isComicSans);
    btn.textContent = isComicSans ? '🤡' : '☻';
    btn.setAttribute('aria-label', isComicSans ? 'Switch to default font' : 'Switch to Comic Sans');
    localStorage.setItem('useComicSans', isComicSans);
  }

  const savedState = localStorage.getItem('useComicSans') === 'true';
  setFontState(savedState);

  btn.addEventListener('click', function() {
    const newState = !document.body.classList.contains('comic-sans');
    setFontState(newState);
  });
})();
</script>
```

### CSS section
```css
/* clown mode */
@font-face {
    font-family: 'Comic Shanns Mono';
    src: url('/fonts/ComicShannsMono-Regular.ttf') format('truetype');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
}

body.comic-sans { 
    font-family: "Comic Sans MS", "Comic Sans", "Comic Shanns Mono", sans-serif;
}

body.comic-sans code { 
    font-family: "Comic Shanns Mono", "Comic Sans MS", "Comic Sans", monospace; 
}

.font-change-button {
    font: inherit;
    font-size: inherit;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
}
```

