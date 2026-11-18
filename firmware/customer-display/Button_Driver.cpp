#include "Button_Driver.h"

OneButton button1(Button_PIN1, true); 
OneButton button2(Button_PIN2, true);                   
Status_Button BOOT_KEY_State = None;                
Status_Button PWR_KEY_State = None;


void Button_Init() {   
  button1.attachLongPressStart(LongPressStart1, &button1);      
  button1.setLongPressIntervalMs(1000);                        
  button1.attachClick(Click1, &button1);                        
  button1.attachDoubleClick(DoubleClick1, &button1);    

  button2.attachLongPressStart(LongPressStart2, &button2);      
  button2.setLongPressIntervalMs(3000);                        
  button2.attachClick(Click2, &button2);                        
  button2.attachDoubleClick(DoubleClick2, &button2);           

  xTaskCreatePinnedToCore(                                     
    ButtonTask,                                            
    "ButtonTask",                                            
    4096,                                                      
    NULL,                   
    3,                                                          
    NULL,                 
    0                                                           
  );  
}

void ButtonTask(void *parameter) {                             
  while(1){
    button1.tick();  
    button2.tick();                                           
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}


void LongPressStart1(void *oneButton){   
  BOOT_KEY_State = LongPressStart;                             
  printf("BOOT LongPressStart\r\n");
}
void Click1(void *oneButton){      
  BOOT_KEY_State = Click;                                                            
  printf("BOOT Click\r\n");
}
void DoubleClick1(void *oneButton){ 
  BOOT_KEY_State = DoubleClick;                                                     
  printf("BOOT DoubleClick\r\n");
}

void LongPressStart2(void *oneButton){     
  PWR_KEY_State = LongPressStart;                                      
  printf("PWR LongPressStart\r\n");
}
void Click2(void *oneButton){      
  PWR_KEY_State = Click;                                          
  printf("PWR Click\r\n");
}
void DoubleClick2(void *oneButton){        
  PWR_KEY_State = DoubleClick;                              
  printf("PWR DoubleClick\r\n");
}