---
category: documents
layout: post
title: Creating reference images for grading tinted film
---

Digitising autonomous colours poses a range of challenges ("chromatic callier-effect"[^1], sensor wavelengths not suitable for autonomous colours[^2], etc.). There is no perfect solution or equipment to overcome these challenges. Every institution has to come up with a solution based on educated guesses and the equipment available - Settle on something pragmatic and document what you do!

In my case, the available equipment is the DFT Scanity (and the MWA Nova Spinner). My educated guesses and typical workflow is based around my knowledge of this scanner's behaviour. Due to the aforementioned scanner sensor sensitivity, I know that some autonomous colours will not be captured in a representative manner. 

In this particular use case I had a tinted feature film, with several tints I knew the Scanity would have trouble capturing. The usual workflow here would be to scan the nitrate print and do grading, while having the nitrate close by for reference. However, a challenge here was that the material would be scanned, and post-processed much later (if at all). Remembering how it looked is not an option, and writing down something like "cyan" is not precise enough.

The film in question is also a six reel feature film, with a multitude of different tints, so grading would most likely take a while. 

I decided instead to find a way to create good reference photos of all the tints from all the reels, during my preparation inspection of the reels. My goal was to create reference photos that were good enough to be used for reference in the grading process, so that I would not have to retrieve the nitrate materials from the vault again.
 
## Creating reference images
After some thinking I landed on an approach that was easy to set up and did not require for me to get any equipment I did not already have available.

Equipment needed:
- Light box (Kaiser slimite plano LED)
- Camera with manual settings
- Macro lens/macro ring (Laowa 50mm f/2.8 2X Ultra Macro APO)
- Friction arm/tripod
- A trusted monitor

First of all you need a reliable light source. High CRI and known colour temperature is a plus. I’ve been using a Kaiser slimite plano table, which is easily obtained, affordable and supposed to be 95CRI. You get what you pay for, and I’ve noticed that mine has slight variations in luminance, and the given colour temperature (while consistent) is only in the ballpark of the given 5000K. Mine seems to be around 5300K. 
 
For the camera, I reckon you can use anything you have available that can be set to manual settings. I’ve used a macro lens on a Panasonic G9. I used aperture priority, with spot metering set on the white light source (not the film), to compensate for the slight variations in luminance from the Kaiser light box. If you do metering on the actual film strip, you will get unwanted variations. 

Use a remote shutter, or delay on the shutter, to keep the shots sharp (even though that's not really a prerequisite for judging colour here).
 
Review the results on a monitor you trust, until you know how close you will get to the source. I reviewed the photos on the calibrated monitor of my Macbook pro m1, set to rec709 colorspace. 

I also applied a simple and consistent contrast change to my photos, to compensate to some degree for the diffuse light source. Before using the photos applied a white point adjustment to D65, for grading in Rec709. You need to pay some attention to colour spaces here!

---
{: data-content="camera and tripod setup"}

![](/assets/img/reference-images/tripod.jpg)

---

## Results
Working like this produced good results, with reference images that very accurately reproduced the colours of the film as I saw them on the light box. 

There are some limitations here of course: I am using a diffuse light source which can result in colour shifts. Projected contrast is also left to my guesswork. However, without a collimated light source I will have to accept these limitations. I still assume the reference image represent the colours much more accurately than our scanners capture them. Another point here is that you can document the colours *in relation* to each other. The colours might be 100% accurate, but you can know document that yellow 1 has redder midtones/shadows than yellow 2 for example. As long as you are aware of the limitations of what you are doing, I think this is a valid approach to documenting film colours - at least in the short term for grading help.

For assessment controls of film material you could work like this to produce photo documentation very easily. For the film in question I took around 100 reference images like this.

---
{: data-content="typical reference image"}

![](/assets/img/reference-images/reference.jpg)

---

I would do some changes to my approach, if I were to do this for other film material:
- I would use the camera tethered to a computer, so that I could use remotely trigger the shutter, adjust focus better and do reviews of the images' "representativeness" more effectively.
- I would use a friction arm to hold the camera, so that the camera would be less obstructive in my working space.
- Device a practical collimated light source for better colour and contrast capture (overhead projectors are not viable in cramped conditions).

## Scan/reference image comparisons

Using these reference images it is easy to do an informal comparison with scans made on our Scanity and Spinner scanners. It is very easy to highlight the scanners' sensor sensitivity blindspots with such a comparison. The scans were made with neutral RGB balance in the scanner lights.
 
The problem tints I tend to be on the lookout for are any yellows with reds in them, pinks and light blues. They can do crazy shifts on some scanners. Some pale blues are completely invisible to the Scanity…

There were many different tints in the film in question:
- Green 1 used for title and one other shot
- Green 2 used for intertitles
- Yellow 1 (with reddish midtones)
- Yellow 2 (a purer yellow, with more neutral midtones). Really subtle difference from yellow 1. Stands out when compared directly to yellow 1
- Red 1 (fiery pure red)
- Red 2 (fiery red leaning to orange in mid/highs)
- Coral (pinkish orange)
- Aquamarine/cyan
- Black and white-ish. It is fairly warm/brown, most likely due to base discolouration. Really hard to see with no clear film side by side. Could possibly be toned?

The Scanity struggles to accurately capture several of these applied colours. The Spinner fares slightly better with of the tints (perhaps due to its bayer sensor?). However, I would not use our Spinner for preservation scans of 35mm, as we have one of the simpler model.

An interesting note here is that the "Green 1" tint was not captured entirely accurately by my camera setup. The actual colour is somewhere in between what the Scanity captured and the reference image.

| Tint | Scanity | Spinner | Reference |
|:--|:--|:--|:--|
| Green 1 | ![](/assets/img/reference-images/scanity-green-1.png) | ![](/assets/img/reference-images/spinner-green-1.png) | ![](/assets/img/reference-images/ref-green-1.png) |
| Green 2 | ![](/assets/img/reference-images/scanity-green-2.png) | ![](/assets/img/reference-images/spinner-green-2.png) | ![](/assets/img/reference-images/ref-green-2.png) |
| Yellow 1 | ![](/assets/img/reference-images/scanity-yellow-1.png) | ![](/assets/img/reference-images/spinner-yellow-1.png) | ![](/assets/img/reference-images/ref-yellow-1.png) |
| Yellow 2 | ![](/assets/img/reference-images/scanity-yellow-2.png) | ![](/assets/img/reference-images/spinner-yellow-2.png) | ![](/assets/img/reference-images/ref-yellow-2.png) |
| Red 1 | ![](/assets/img/reference-images/scanity-red-1.png) | ![](/assets/img/reference-images/spinner-red-1.png) | ![](/assets/img/reference-images/ref-red-1.png) |
| Red 2 | ![](/assets/img/reference-images/scanity-red-2.png) | ![](/assets/img/reference-images/spinner-red-2.png) | ![](/assets/img/reference-images/ref-red-2.png) |
| Coral | ![](/assets/img/reference-images/scanity-coral-1.png) | ![](/assets/img/reference-images/spinner-coral-1.png) | ![](/assets/img/reference-images/ref-coral-1.png) |
| Acquamarine/Cyan | ![](/assets/img/reference-images/scanity-cyan-1.png) | ![](/assets/img/reference-images/spinner-cyan-1.png) | ![](/assets/img/reference-images/ref-cyan-1.png) |
| Black/white | ![](/assets/img/reference-images/scanity-bw-1.png) | ![](/assets/img/reference-images/spinner-bw-1.png) | ![](/assets/img/reference-images/ref-bw-1.png) |

As a side note at the very end of this document. I've never managed to decide on which grading approach give the best results in the most effective manner: 1. grading the scans as colour film or 1. desaturating the scans and creating the colours from scratch. Considering how the Scanity actually captured some of these colours, getting to a good end-result might require going for the second approach. 

If I were to go for the second approach an option would be to scan the film using the monochrome HDR mode of the Scanity, to capture a wider density range. 

Scanning the film in colour is still worth it though, as it at least captures that there were colours in the film (even though they are not rendered correctly in the scan).

This text is based on various tests and work I did in 2022.

---
{: data-content="footnotes"}

[^1]: Fluckiger et al. (2018). *Investigation of Film Material–Scanner Interaction.* Fluckiger. (n.d.). Investigation of film material–scanner interaction. Retrieved March 9, 2023, from [https://barbaraflueckiger.files.wordpress.com/2018/03/flueckigeretal_investigationfilmmaterialscannerinteraction_2018_v_1-1c.pdf](https://barbaraflueckiger.files.wordpress.com/2018/03/flueckigeretal_investigationfilmmaterialscannerinteraction_2018_v_1-1c.pdf)
[^2]: Trumpy, Giorgio & Flueckiger, Barbara. (2018). *Chromatic Callier Effect and its Repercussions on the Digitization of Early Film Colors.* Journal of Imaging Science and Technology. 63. [10.2352/J.ImagingSci.Technol.2019.63.1.010506](https://www.researchgate.net/publication/327937633_Chromatic_Callier_Effect_and_its_Repercussions_on_the_Digitization_of_Early_Film_Colors).



