#pragma once
#include "Arduino.h"
#include "Display_ST7789.h"
#include "Button_Driver.h"

#define PWR_KEY_Input_PIN   6
#define PWR_Control_PIN     7



void Shutdown(void);

void PWR_Init(void);
void PWR_Loop(void);