module ApplicationHelper
  def display_categories(categories)

    ret = "<table width ='100%' align='center' border=0 >"
    for category in categories
      if category.parent_id == nil
        @colspan = category.all_children.size
#        ret += "<tr>"
#        i=0
#        for i in 0...@colspan
#          ret += "<td width = '#{100/@colspan}%'> &nbsp;</td>"
#        end
#        ret += "</tr>"
        ret += "<tr>"
        ret += "<td align='center' colspan = '#{@colspan}'>"
        ret += link_to category.name
        ret += "</td>"
        ret += "</tr>"
      if @colspan > 0
        ret += find_all_subcategories(category)
      end
      end
    end
    ret += "</table>"

  end

  def find_all_subcategories(category)
    if category.children.size > 0

      @colspan = (@colspan/2).to_i
      if @class == 'even'
        ret = '<tr class=even>'
        @class = 'odd'
      else
        ret = '<tr class=odd>'
        @class = 'even'
      end
      category.children.each { |subcat|
        if subcat.children.size > 0
          ret += "<td align='center' valign='top' colspan= '#{@colspan}'>"

          ret += link_to h(subcat.name), :action => 'edit', :id => subcat
          ret += "<table width = '100%' align='center'>"
          ret += find_all_subcategories(subcat)
          ret += "</table>"
          ret += "</td>"

        else
          ret += "<td align='center' valign='top' colspan= '#{@colspan}'>"

          ret += link_to h(subcat.name), :action => 'edit', :id => subcat
          ret += "</td>"

        end
      }
      ret += "</tr>"
    end
  end
end
