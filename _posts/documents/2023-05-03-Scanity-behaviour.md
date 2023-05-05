---
layout: post
slug: hr example
category: documents
---

## Abstract
This is an attempt to type out the operating principles of DFT's Scanity film scanner and how it captures image information. This text is a condensation of information found in the Scanity manual and the "Scanity white paper", in addition to information discovered through testing performed on Scanity #201 at the National Library of Norway. 

*Due to the Scanity manual being copyrighted and confidential, the information in this document should not be shared with anyone not owning a Scanity.*

---
## RGB light path
The Scanity uses spectrally-separate red, green and blue LED light sources. The Scanity has two sets of red LEDs with slightly different center wavelengths: **Red 0** for materials with an orange mask (negatives/intermediates) and **Red 1** that should be used for print film. The **red LED type** to be used is selected using the **[Filmstock presets](#filmstock-presets)**. 

In this document the light sources are referred to as "0" and "1" (rather than "1" and "2"), as this corresponds with how the configuration of the **Filmstock** presets selects **red LED type** (see [IsPrint setting](#selecting-red-led-type-to-be-used-isprint)). 

The "Investigation of Film Material–Scanner Interaction"[^1] states that the exact spectral characteristics of the LEDs are:
- Red 0: 660nm (colour negative/intermediate)
- Red 1: 690nm (positive print)
- Green: 530nm
- Blue : 446nm 

![Scanity RGB light path](https://user-images.githubusercontent.com/113333557/225334504-823bf215-234e-4b7f-b141-a4745b0e15d8.png)

The light from the LEDs passes through an integration sphere, which assures uniform and diffuse[^2] lighting, before it passes through the film, into a colour beam splitter, before hitting the red, green and blue TDI sensors[^3]. More information about the light path is found in the [Scanity whitepaper](https://www.dft-film.com/downloads/datasheets/Scanity-Whitepaper.pdf). 


Preliminary test-scans of Kodak 2242 intermediate material using the two different **red LED types** indicate subtle differences in captured data. The most obvious difference seem to be information being "lifted" near **maximum density** (D-max) in the red channel, when using the **Red 1** light source intended for print film. 

Further testing should be performed to determine the impact the choice of **red LED type** has on captured data.

A basic intro to sensitometry concepts mentioned in this document like **Density** and **Printer lights**, are found at the end of this document (see [Appendix: Sensitometry basics](#appendix-sensitometry-basics)). 

--- 
### Settings influencing captured data
Apart from the choice of **red LED type**, the only other setting that influence the amount of information captured by the sensor is the **Light** setting ("Light (Minimum density)"). The **Light** setting can be adjusted individually for red, green and blue, and controls the light intensity of the scanner LED light sources. The unit for this setting is printer light points, with a neutral setting of 25 for each colour channel (see [light setting offsets](#filmstock-setting-formatting)).

Scanning in **monochrome HDR** is also an option that influence captured data, but at the moment this document is primarily concerned with colour materials. When using the monochrome HDR option, the **Red 0** light source is used[^8]*

---
## RGB data path
The 16bit RGB data coming from the **sensor** goes through several processing steps in the shape of LUTs[^4] and Matrixes[^5] before a file is rendered:

![Scanity RGB data path](https://user-images.githubusercontent.com/113333557/225334788-9701f9aa-e47e-47d6-b4b0-f8c887aa17f1.png)

→ **L1 LUT** ("LUT Color space Log"). The **L1 LUT** should in theory turn the linear data into logarithmic data. The manual states it's supposed to "rectify the exposure time and film density into a linear characteristic".  The data is now 16bit log. →

→ **3x3 matrix** ("color space matrix"). The default option is a "1:1" matrix (bypass). There is a different selectable matrix option named "Bypass", that seems to do the same as "1:1". The data is now 16bit log. →

→ **L2 LUT** ("LUT Color space delog"). The data is now 16bit linear. →

→ **Main LUT**. The final processing stage before a file is output. The **Main LUT** can process the data in several possible ways. 

---
### LUT-Matrix-LUT
The default "1:1" settings in the LUT-Matrix-LUT pipeline does not do anything to the data. The manual states that the "1:1 LUT and 1:1 matrix selection [...] will set the stages into a bypass mode". Steps 2 to 4 can thus be ignored, as long as the default 1:1 settings are used. 

You can define custom **L1**/**L2 LUTs** and **Matrixes**. It is assumed such data processing could be applied as easily in a later stage of post-processing. The possible benefits of setting up a custom LUT-Matrix-LUT path, should be explored. 

Unless custom settings are used, the data is formatted as 16bit linear when the **Main LUT** is applied.

---
### Main LUT
The **Main LUT** is more complicated as it is created on a per scan-basis based on the configuration of three settings found in the software:

- **Characteristic** 
    - This is the core part of the **Main LUT**. It consists of three default LUTs/gamma curves + user defined custom LUTs: 
        - LIN (linear)
        - CRT ("TV Gamma 2.2", logarithmic)
        - CPD ("Cineon Print Density", logarithmic)
        - CUSTOM (special conditions apply, see below)
- **Postive/negative** 
    - This setting is used to invert the image.
- **Density range** ("Density range (transition)")
    - This setting applies gamma/gain adjustments to the selected **Characteristic** LUT/curve, accodring to the manual. (This seems to apply a  **Lift**, rather than **Gain**)
    - As indicated by the naming in the [formatting](#filmstock-configuration-formatting) of the **Filmstock** setting, it is likely that the intended way to use this setting is to define maximum density (Dmax) of each colour channel for a particular film stock (as per film stock specifications).

#### Custom Main LUT
In addition to the three predefined characteristics, you can define a **custom Main LUT**. This is done by selecting a custom LUT using the **Characteristic** setting. When a custom **Main LUT** is used, the **Positive/negative** and **Density range** settings are deactivated.

---
### Filmstock presets
To complicate matters there are film stock presets that influences your result. 

The selected **Filmstock** will apply preset valuess to several other settings on the Scanity. They are made for optimal(?) capture of various different analog film stocks. There are several predefined **Filmstock** presets (eg. a preset for Kodak 2242). The default preset is called "**Print**".

Selecting a **Filmstock** preset sets these core settings to predefined values in the Scanity software: 

- **Red LED type** (no visual indication of toggle in software)
- **Light** (no visual indication of changes in software)
- **Positive/negative**
- **Density range**
- **L1/L2 LUTs + colour space matrix** (all predefined film stocks use the default 1:1 settings)


#### Filmstock configuration formatting
The **Filmstock** configuration file is formatted like this (space-separated):

```
"name" WhiteDensity(r g b) BlackDensity(r g b) IsNegative IsPrint IsFactoryMem ColorSpaceLog ColorSpaceMatrix ColorSpaceDelog

"Print" 0 0 0 3.5 3.5 3.5 0 1 1 1:1 1:1 1:1
```

This configuration formatting translates to:

| Configuration name | Function/setting | Usage/explanation |
|:--|:--|:--|
| "name" | Preset name | Defines the name of the preset as it will appear in the Scanity software. |
| WhiteDensity(r g b) | **Light** setting offset R G B |  Sets the **Light** setting offset. 0=no offset. An increment of +1 printer light point is defined as an offset of 0.025 (exact: 0.0250858. See logE under see [Sensitometry basics](#appendix-sensitometry-basics)). |
| BlackDensity(r g b)[^6] | **Density Range** setting R G B | Sets **Density range**. 3.5 is the default setting. |
| IsNegative | **Positive/negative** setting | 1=invert, 0=no change |
| IsPrint | **Red LED type** | Selects which **red LED type** to be used by the preset: 0=intermediate (**Red 0**), 1=print (no mask) (**Red 1**) |
| IsFactoryMem | Read-only toggle | Prevents the preset from being deleted within the Scanity software. 1=read only. |
| ColorSpaceLog | **L1 LUT** (ColorSpaceLog) | Selects **L1 LUT** |
| ColorSpaceMatrix | **Color Space Matrix** | Selects **3x3 Matrix** |
| ColorSpaceDelog | **L2 LUT** (ColorSpaceDelog) | Selects **L2 LUT** |

#### Selecting red LED type to be used (IsPrint)
The **IsPrint** config is crucial, as it determines which **red LED type** is used when scanning. 0 selects **Red 0** intended for scanning material with an orange mask (negatives/intermediates), while 1 is for selecting **Red 1** which should be used for all (?) other material. 

If the spectral dye densities in the material to be scanned is known, the red light source that is closest to the the peak wavelength of the cyan densities should be used.

The default **Print** preset uses the **Red 1** source intended for print material.

There does not seem to be any other way to select **red LED type** within the software.

#### Light setting offsets
The **Filmstock** presets can store offsets to the **Light** settings. The operator needs to be aware of the offsets in the presets used, as these offsets are hard to detect within the Scanity software. When selecting and loading a **Filmstock** preset with modified **Light** settings (values of anything other than 25), the **Light** values will still appear as red=25 green=25 blue=25 in the Scanity interface. These settings represent different **Light** settings than red=25 green=25 blue=25 using the default **Print** preset.

The default **Print** preset is defined with 0 offsets to the **Light** settings and **Density range** settings of exact 3.5.


#### Density range offsets?
An unexpected behaviour discovered while looking at the **Filmstock** settings, is that changing **Light** settings create offsets to the **Density range** settings. This can be confirmed by checking the **Filmstock** settings/config file.

Increasing **Lights** by 1 printer light point, yields an increase in **Density range** of 0.02509. This is not visible in the software, where the **Density range** will appear untouched. In the **Filmstock** config file however, settings of **Lights** of 26 and an untouched **Density range** of 3.5, will be stored as **Light** offsets of 0.0250858 and a **Density range** of 3.52509.   

Considering the offsets' relationship to printer light steps (changes of 0.025 logE), it is assumed that the **Density range** offsets are applied to somehow better emulate the behaviour of printer lights in photochemical printing or the cineon workflow. Another possibility is that it is there to camouflage the sensor noise floor. The reasoning behind this behaviour needs to be explained by DFT.

Initial tests indicate that increased **Light** settings behave similarly to increased printer lights, *up until* a density of 1.8-2 (if using the LIN characteristic). If you are using a custom linear **Main LUT** the lights behave linearly up to a density of 2.2-2.5. Information in higher densities than this, behave non-linearly, and will form a "toe" in the gamma curve. 

Further tests should be carried out to explore this behaviour

---
## Alpha component light/data path
In addition to the RGB components of the data, the Scanity produces an **Alpha component** based on information in the IR spectrum. This data is used to create a "dirt/scratch matte", that can be used to identify (and post-process) dirt and scratches on the film. The description of the IR light and data path is less detailed than for the RGB light/data, but the "Dirt" page in the Scanity settings controls the processing of the data. 

It seems the IR data goes through it's own data path. The data processing can be set in a bypass mode that should produce an output that "reflects the IR signal of the camera". It appears the IR sensor is of the same TDI design as the RGB sensors.

![Alpha component light/data path?](https://user-images.githubusercontent.com/113333557/225338455-2616282c-8d4c-417f-84c4-2ccbe09eb000.png)

*As the aim of this document (for now) is to determine how "visible" colour information is captured by the Scanity, the **Alpha component** can be ignored.*

---
{: data-content="footnotes"}

[^1]:Fluckiger et al. (2018). *Investigation of Film Material–Scanner Interaction.* Fluckiger. (n.d.). Investigation of film material–scanner interaction. Retrieved March 9, 2023, from <https://barbaraflueckiger.files.wordpress.com/2018/03/flueckigeretal_investigationfilmmaterialscannerinteraction_2018_v_1-1c.pdf> 

[^2]:Diffuse light sources produce a softer image both in terms of sharpness and contrast, than collimated lighting, but hides scratches. Diffuse lighting also impacts colour reproduction and  See: Trumpy, Giorgio & Flueckiger, Barbara. (2018). *Chromatic Callier Effect and its Repercussions on the Digitization of Early Film Colors.* Journal of Imaging Science and Technology. 63. 10.2352/J.ImagingSci.Technol.2019.63.1.010506.

[^3]: Teledyne DALSA monochrome TDI line sensors. 4320x96 pixel resolution. The Scanity sensors' analog to digital converters only has 14bits available according to "Investigation of Film Material–Scanner Interaction" (see footnote 1). This "raw" 14bit signal is packaged into a 16bit signal before it reaches the LUT-Matrix-LUT though, and is never available for manipulation by an end-user.

[^4]:A LUT or a "Lookup table" that can be used to modify video files. It works by changing brightness values (of a pixel), by mapping each input value to a new output value based on a table (the LUT). LUTs come in two flavours: 1D LUTs and 3D LUTs. 1D LUTs modify data on a single axis (gamma/contrast for all channels), while a 3D LUT modifies data around on three axes separately (R, G and B). 1D LUTs can modify gamma/white balance, but not modify colour *gamut*. 3D LUTs can do both. The Scanity operates with 1D LUTs, or rather 3x1D LUTs (a 1D LUT for each colour channel R, G and B, packed in a single file). A linear LUT in the context of the Scanity is a LUT that does not change any of the R, G and B values. Eg. 0=0, 1=1 etc, from 0 all the way to 65534 (16bit):

	| R | G | B |
	|:---|:---|:---|
	| 1 | 1 | 1 |
	| 2 | 2 | 2 |
	| 3 | 3 | 3 |
	| etc. | ... | ... |
	| 65534 | 65534 | 65534 |

[^5]:A matrix is a function used to modify RGB **primaries**. They can can be used to convert and transform colour spaces. 3x3 Matrixes function by multiplying the R,G and B values. If you are working with 1D LUTs, a LUT-Matrix-LUT pipeline is needed if you want to modify both **gamma** and **gamut**. This is what the Scanity does. 3x1D LUT-Matrix-3x1D LUT. A bypass matrix does nothing as it multiplies the R, G and B primaries by 1, and looks like this:

	| R | G | B |
	|:---|:---|:---|
	| 1.0 | 0 | 0 |
	| 0 | 1.0 | 0 |
	| 0 | 0 | 1.0 |

[^8]: DFT. (2020, November) *Scanity HDR Whitepaper.* Retrieved March 27, 2023, from <https://www.dft-film.com/downloads/datasheets/HDR-Whitepaper.pdf>

